# Import Keras 3 directly, NOT tensorflow.keras. `tensorflow.keras` is a lazy alias that picks
# Keras 3 or tf_keras (Keras 2) on first use based on TF_USE_LEGACY_KERAS, and transformers sets
# TF_USE_LEGACY_KERAS=1 as soon as DistilBERT is used. If that happened before the first image
# training, keras.Input came from tf_keras while MobileNetV2/layers came from Keras 3: the model
# turned into ~300 tf_op_lambda layers with zero trainable weights, so every prediction was 50/50.
import keras
from keras import layers
from keras.applications import EfficientNetB0, MobileNetV2
from keras.applications.mobilenet_v2 import preprocess_input as mobilenet_v2_preprocess_input
import h5py
import numpy as np
import random
import os
import tempfile
import time
import shutil
from typing import List, Dict, Any, Tuple, Optional
from datetime import datetime, timezone
import logging
from google.cloud import storage
from google.cloud import firestore
import json
import gc
import time
from sklearn.metrics.pairwise import cosine_similarity

# Configure logging
logger = logging.getLogger(__name__)

# Pixel preprocessing, stored in metadata.json so prediction always matches training.
# New models use MobileNetV2's own scaling ([-1, 1]), which its ImageNet weights expect.
# Models saved before this field existed were trained on pixels / 255 ([0, 1]).
PREPROCESSING_MOBILENET_V2 = "mobilenet_v2"
PREPROCESSING_LEGACY_0_1 = "rescale_0_1"
# EfficientNet rescales inside the model (Keras applications), so it takes raw 0-255 pixels.
PREPROCESSING_EFFICIENTNET = "efficientnet"

# The two models a learner can pick on the training page (Image Recognition):
#   mobilenet     MobileNetV2 (width 0.35) at 128 px: small and fast. The default, and every model
#                 saved before this choice existed.
#   efficientnet  EfficientNetB0 at 224 px: bigger and slower, usually steadier on harder images.
# The choice is stored in metadata.json ("architecture") so prediction rebuilds the same model.
ARCHITECTURES = {
    "mobilenet": {"img_size": (128, 128), "preprocessing": PREPROCESSING_MOBILENET_V2, "label": "MobileNet"},
    "efficientnet": {"img_size": (224, 224), "preprocessing": PREPROCESSING_EFFICIENTNET, "label": "EfficientNet"},
}
DEFAULT_ARCHITECTURE = "mobilenet"


def normalize_architecture(name: Optional[str]) -> str:
    name = (name or "").strip().lower()
    return name if name in ARCHITECTURES else DEFAULT_ARCHITECTURE

class ImageRecognitionTrainer:
    """Ultra-lightweight training service optimized for small datasets (5-10 images per class).

    Holds per-model state (model, class_names, preprocessing), so use one instance per
    train/predict request rather than sharing one across concurrent requests.
    """

    def __init__(self, architecture: str = DEFAULT_ARCHITECTURE):
        self.architecture = normalize_architecture(architecture)
        self.img_size = ARCHITECTURES[self.architecture]["img_size"]
        self.batch_size = 8  # Larger batch size for efficiency
        # Learning rate 0.001 for 60 epochs (early stopping on loss): picked with
        # scripts/benchmark_image_models.py by leave-one-out on the 20 sample training images.
        # The old 0.01 x 20 overfitted: EfficientNet 15/20 -> 17/20 leave-one-out, 10/12 -> 12/12 on
        # the standard test images; MobileNet 16/20 -> 17/20, handwritten 15/20 -> 17/20.
        self.epochs = 60
        self.learning_rate = 0.001
        self.seed = 7  # same images -> same model, so a workshop room sees the same results
        self.model = None
        self.class_names = []
        self.is_trained = False
        self.use_lightweight = True  # Use lightweight MobileNetV2
        self.preprocessing = ARCHITECTURES[self.architecture]["preprocessing"]
        self.last_error = None  # Reason the last load_model_from_gcs failed, for the API response
        self.last_model_bytes = 0  # size of the saved weights, shown on the training page

    def _preprocess(self, images: np.ndarray) -> np.ndarray:
        """Scale raw 0-255 pixels the same way the model was trained."""
        images = np.array(images, dtype=np.float32, copy=True)
        if self.preprocessing == PREPROCESSING_LEGACY_0_1:
            return images / 255.0
        if self.preprocessing == PREPROCESSING_EFFICIENTNET:
            return images  # the model rescales its own input
        return mobilenet_v2_preprocess_input(images)

        
    def prepare_training_data_direct(self, image_examples: List[Dict[str, Any]]) -> Tuple[np.ndarray, np.ndarray, List[str]]:
        """Prepare training data directly from GCS images with minimal augmentation for speed"""
        random.seed(self.seed)  # the same augmented copies on every run (see self.seed)
        try:
            # Group images by label
            label_groups = {}
            for example in image_examples:
                label = example.get('label', 'unknown')
                image_url = example.get('image_url', '')
                
                if not image_url or not label:
                    continue
                    
                if label not in label_groups:
                    label_groups[label] = []
                label_groups[label].append(image_url)
            
            # Process images directly from GCS with minimal augmentation
            images = []
            labels = []
            class_names = []
            label_to_idx = {}
            
            for label, image_urls in label_groups.items():
                if len(image_urls) < 1:  # Allow single image per class
                    continue

                label_images = []
                failed = 0

                # Process each image with minimal augmentation for speed
                for i, image_url in enumerate(image_urls):
                    try:
                        # Download image directly to memory
                        image_data = self._download_image_to_memory(image_url)
                        if image_data is not None:
                            # Add original image
                            label_images.append(image_data)

                            # Apply minimal augmentation (only 3x for speed)
                            label_images.extend(self._apply_minimal_augmentation(image_data))

                    except Exception as e:
                        failed += 1
                        logger.warning(f"Failed to process image {image_url}: {e}")
                        continue

                loaded = len(image_urls) - failed
                logger.info(f"Label '{label}': loaded {loaded}/{len(image_urls)} images ({len(label_images)} samples with augmentation)")
                if not label_images:
                    # Don't create an output class that has no training data
                    logger.warning(f"Label '{label}' has no usable images and is left out of training")
                    continue

                label_to_idx[label] = len(class_names)
                class_names.append(label)
                images.extend(label_images)
                labels.extend([label_to_idx[label]] * len(label_images))

            if not class_names:
                raise ValueError("No valid image data found for training")
            if len(class_names) < 2:
                raise ValueError(
                    f"Need images for at least 2 labels, but only '{class_names[0]}' had images that could be read"
                )
            
            # Convert to numpy arrays
            images_array = np.array(images)
            labels_array = np.array(labels)
            
            logger.info(f"Prepared training data: {len(class_names)} classes, {len(images)} total images")
            logger.info(f"Images shape: {images_array.shape}, Labels shape: {labels_array.shape}")
            
            return images_array, labels_array, class_names
            
        except Exception as e:
            logger.error(f"Error preparing training data directly: {e}")
            raise Exception(f"Failed to prepare training data: {str(e)}")
    
    def _apply_minimal_augmentation(self, image: np.ndarray) -> List[np.ndarray]:
        """Apply minimal data augmentation for speed: 3 variants of a raw 0-255 RGB image.

        Each variant gets a small random rotation, shift/zoom, brightness change and
        possibly a horizontal flip. (The old ImageDataGenerator brightness shift cast
        [0, 1] floats to uint8, which turned every augmented copy black.)
        """
        from PIL import Image, ImageEnhance

        augmented_images = []

        try:
            pil_image = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8))
            width, height = pil_image.size

            for _ in range(3):  # Only 3 augmented versions for speed
                aug = pil_image.rotate(random.uniform(-15, 15), resample=Image.BILINEAR)
                # Crop 85-95% of the image at a random offset: small shift + zoom that also trims rotation corners
                scale = random.uniform(0.85, 0.95)
                crop_w, crop_h = int(width * scale), int(height * scale)
                left = random.randint(0, width - crop_w)
                top = random.randint(0, height - crop_h)
                aug = aug.crop((left, top, left + crop_w, top + crop_h)).resize(self.img_size)
                if random.random() < 0.5:
                    aug = aug.transpose(Image.FLIP_LEFT_RIGHT)
                aug = ImageEnhance.Brightness(aug).enhance(random.uniform(0.9, 1.1))
                augmented_images.append(np.asarray(aug, dtype=np.float32))

        except Exception as e:
            logger.warning(f"Augmentation failed: {e}")
            # If augmentation fails, return empty list (original image already added)

        return augmented_images
    
    def _download_image_to_memory(self, gcs_url: str) -> Optional[np.ndarray]:
        """Download image from GCS URL directly to memory and return as numpy array"""
        try:
            # The app's shared GCS client (a new client per image costs about a second)
            from .config import gcp_clients
            client = gcp_clients.get_storage_client() or storage.Client()
            
            # Parse GCS URL to get bucket and blob name
            if gcs_url.startswith('gs://'):
                url_parts = gcs_url[5:].split('/', 1)
                bucket_name = url_parts[0]
                blob_name = url_parts[1]
            else:
                raise ValueError(f"Invalid GCS URL format: {gcs_url}")
            
            # Download the blob to memory
            bucket = client.bucket(bucket_name)
            blob = bucket.blob(blob_name)
            image_bytes = blob.download_as_bytes()
            
            # Convert bytes to PIL Image
            from PIL import Image
            import io
            
            header = image_bytes[:20]
            logger.debug(f"Downloaded {len(image_bytes)} bytes from GCS: {gcs_url} (header {header.hex()})")

            try:
                pil_image = Image.open(io.BytesIO(image_bytes))
                logger.info(f"Opened image {gcs_url}: {pil_image.format}, {pil_image.mode}, {pil_image.size}")
            except Exception as img_error:
                logger.error(f"Failed to open image from bytes: {img_error}")
                # Log error without creating debug files in production (avoids disk fill)
                logger.error(f"Cannot identify image file: {img_error}")
                logger.error(f"Image bytes length: {len(image_bytes)} bytes")
                raise ValueError(f"Cannot identify image file: {img_error}")
            
            # Convert to RGB if needed
            if pil_image.mode != 'RGB':
                logger.info(f"Converting image from {pil_image.mode} to RGB")
                pil_image = pil_image.convert('RGB')
            
            # Resize to target size
            pil_image = pil_image.resize(tuple(self.img_size))

            # Raw 0-255 pixels; scaling for the model happens in _preprocess
            return np.array(pil_image).astype(np.float32)
            
        except Exception as e:
            logger.error(f"Failed to download image from GCS to memory: {e}")
            raise e
    
    def _download_image_from_gcs(self, gcs_url: str, local_path: str):
        """Download image from GCS URL to local path - FIXED VERSION"""
        try:
            # Initialize GCS client
            client = storage.Client()
            
            # Parse GCS URL to get bucket and blob name
            if gcs_url.startswith('gs://'):
                url_parts = gcs_url[5:].split('/', 1)
                bucket_name = url_parts[0]
                blob_name = url_parts[1]
            else:
                raise ValueError(f"Invalid GCS URL format: {gcs_url}")
            
            # Download the blob to memory
            bucket = client.bucket(bucket_name)
            blob = bucket.blob(blob_name)
            image_bytes = blob.download_as_bytes()
            
            # Save image to local path
            with open(local_path, 'wb') as f:
                f.write(image_bytes)
            
            # FIXED: Keep images in RGB format for EfficientNet
            try:
                from PIL import Image
                img = Image.open(local_path)
                if img.mode != 'RGB':  # Convert to RGB, not grayscale
                    logger.info(f"Converting image from {img.mode} to RGB: {local_path}")
                    img = img.convert('RGB')  # Convert to RGB (3 channels)
                    img.save(local_path, 'JPEG')
                    logger.info(f"Image converted to RGB and saved: {local_path}")
            except Exception as convert_error:
                logger.warning(f"Could not convert image to RGB: {convert_error}")
            
        except Exception as e:
            logger.error(f"Failed to download image from GCS: {e}")
            raise

    def _build_model(self, num_classes: int, load_pretrained: bool = True):
        """Build the chosen base model + classifier. Same architecture for training and load-from-weights.
        Use load_pretrained=False when loading our saved weights to avoid loading ImageNet weights."""
        shape = (int(self.img_size[0]), int(self.img_size[1]), 3)
        weights = "imagenet" if load_pretrained else None
        if self.architecture == "efficientnet":
            base_model = EfficientNetB0(include_top=False, weights=weights, input_shape=shape)
        else:
            base_model = MobileNetV2(include_top=False, weights=weights, input_shape=shape, alpha=0.35)
        base_model.trainable = False
        inputs = keras.Input(shape=shape, name='rgb_input')
        x = base_model(inputs, training=False)
        x = layers.GlobalAveragePooling2D()(x)
        x = layers.Dropout(0.2)(x)
        outputs = layers.Dense(num_classes, activation="softmax", name='predictions')(x)
        model = keras.Model(inputs, outputs, name=f'{self.architecture}_{num_classes}classes')
        model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=self.learning_rate),
            loss="sparse_categorical_crossentropy",
            metrics=["accuracy"],
        )
        return model

    def train_model_direct(self, images: np.ndarray, labels: np.ndarray, class_names: List[str]) -> Dict[str, Any]:
        """Train ultra-lightweight MobileNetV2 model optimized for small datasets"""
        try:
            logger.info("🚀 Starting ultra-lightweight MobileNetV2 training for small datasets...")
            logger.info(f"📊 Training with {len(class_names)} classes: {class_names}")
            logger.info(f"📊 Training with {len(images)} images, shape: {images.shape}")
            
            # Clear everything
            logger.info("🧹 Performing cleanup...")
            self.model = None
            self.is_trained = False
            
            # Clear TensorFlow completely
            self.nuclear_tensorflow_reset()

            # Get number of classes
            num_classes = len(class_names)
            self.class_names = class_names
            self.preprocessing = ARCHITECTURES[self.architecture]["preprocessing"]
            started = time.time()
            
            logger.info(f"📊 Detected {num_classes} classes: {class_names}")
            
            # Verify input data is RGB
            if len(images.shape) != 4:
                raise ValueError(f"Expected 4D image array, got shape: {images.shape}")
            
            actual_channels = images.shape[3]
            logger.info(f"✅ Confirmed image data has {actual_channels} channels (RGB)")
            
            if actual_channels != 3:
                raise ValueError(f"MobileNetV2 requires RGB images (3 channels), got {actual_channels} channels")
            
            # Fixed seed: classifier weights, dropout and shuffling are the same on every run
            keras.utils.set_random_seed(self.seed)

            # Build model (shared architecture for training and load-from-weights)
            self.model = self._build_model(num_classes)

            logger.info(f"🏗️ Model built with {num_classes} output classes")
            logger.info(f"📋 Final model input shape: {self.model.input_shape}")
            logger.info(f"📋 Final model output shape: {self.model.output_shape}")

            # Print model summary
            self.model.summary(print_fn=logger.info)

            # Guard against a model that cannot learn (e.g. built from mixed Keras versions)
            trainable_count = len(self.model.trainable_weights)
            if trainable_count == 0:
                raise ValueError("Image model has no trainable weights; refusing to train a model that cannot learn")

            x = self._preprocess(images)

            # Verify model accepts our data shape
            logger.info(f"🔍 Verifying model accepts data shape: {x.shape}")
            try:
                test_pred = self.model.predict(x[:1], verbose=0)
                logger.info(f"✅ Model verification successful, output shape: {test_pred.shape}")
            except Exception as verify_error:
                logger.error(f"❌ Model verification failed: {verify_error}")
                raise Exception(f"Model cannot process input data: {verify_error}")

            # Shuffle once (data arrives grouped label by label). No validation split: with
            # 5-10 images per label, a split is a handful of augmented copies of training images
            # (and used to be almost entirely the last label), so callbacks watch training loss.
            order = np.random.RandomState(self.seed).permutation(len(x))
            x, y = x[order], labels[order]

            # The base model is frozen, so each image's features are the same in every epoch: compute them
            # once, then train only the classifier on top (Dropout + Dense) and copy its weights into the
            # full model. Same model as fitting the whole network, but EfficientNet runs once per image
            # instead of once per image per epoch (about 80 s -> a few seconds on the sample).
            logger.info("🎯 Training the classifier on frozen-base features...")
            pooled = next(l for l in self.model.layers if isinstance(l, layers.GlobalAveragePooling2D))
            features = keras.Model(self.model.inputs, pooled.output).predict(x, batch_size=32, verbose=0)
            dense = self.model.get_layer('predictions')
            head = keras.Sequential([
                keras.Input(shape=(features.shape[1],)),
                layers.Dropout(0.2),
                layers.Dense(num_classes, activation="softmax"),
            ])
            head.layers[-1].set_weights(dense.get_weights())  # the same starting weights as the full model
            head.compile(
                optimizer=keras.optimizers.Adam(learning_rate=self.learning_rate),
                loss="sparse_categorical_crossentropy",
                metrics=["accuracy"],
            )
            history = head.fit(
                features,
                y,
                epochs=self.epochs,
                batch_size=self.batch_size,
                verbose=0,
                shuffle=True,
                callbacks=[
                    keras.callbacks.EarlyStopping(monitor='loss', patience=10, restore_best_weights=True),  # More patience for small datasets
                    keras.callbacks.ReduceLROnPlateau(monitor='loss', factor=0.5, patience=5, min_lr=1e-4)  # More stable LR reduction
                ]
            )
            dense.set_weights(head.layers[-1].get_weights())

            # Get final accuracy
            final_accuracy = history.history['accuracy'][-1] if 'accuracy' in history.history else 0.0
            final_loss = history.history['loss'][-1] if 'loss' in history.history else 0.0

            epoch_log = ", ".join(
                f"{i + 1}: loss={loss:.3f} acc={acc:.2f}"
                for i, (loss, acc) in enumerate(zip(history.history['loss'], history.history['accuracy']))
            )
            logger.info(f"📈 Epochs ({len(history.history['loss'])}) - {epoch_log}")
            logger.info(f"✅ Training complete! Final accuracy: {final_accuracy:.4f}, loss: {final_loss:.4f}")
            
            # Mark as trained
            self.is_trained = True
            
            # Create result dictionary
            result = {
                'accuracy': final_accuracy,
                'loss': final_loss,
                'labels': class_names,
                'num_classes': num_classes,
                'training_examples': len(images),
                'model': self.model,
                'class_names': class_names,
                'img_size': self.img_size,
                'architecture': self.architecture,
                'training_seconds': round(time.time() - started, 1),
            }
            
            logger.info("🎉 Ultra-lightweight MobileNetV2 training completed successfully!")
            return result
            
        except Exception as e:
            logger.error(f"❌ Training failed: {e}")
            logger.error(f"❌ Error type: {type(e)}")
            logger.error(f"❌ Error details: {str(e)}")
            raise Exception(f"Image model training failed: {str(e)}")
    
    def nuclear_tensorflow_reset(self):
        """Clear Keras session state before building a new model.

        Does not delete ~/.keras/models: that only forced the ImageNet weights to be
        re-downloaded on every training and could pull the file out from under another
        training running at the same time.
        """
        try:
            keras.backend.clear_session()
            gc.collect()
        except Exception as e:
            logger.warning(f"⚠️ Keras session reset encountered issues: {e}")
    
    def predict_image(self, img_path: str) -> Dict[str, Any]:
        """Make prediction on a single image using ultra-lightweight MobileNetV2"""
        try:
            if not self.is_trained or not self.model:
                raise ValueError("Model not trained yet")
            
            # Load and preprocess image
            img = keras.utils.load_img(img_path, target_size=tuple(self.img_size), color_mode='rgb')
            x = keras.utils.img_to_array(img)
            x = self._preprocess(np.expand_dims(x, axis=0))
            
            # Make prediction with the trained model
            preds = self.model.predict(x, verbose=0)
            predicted_class_idx = np.argmax(preds)
            confidence = float(np.max(preds) * 100)  # Convert to percentage and ensure float
            
            # Get predicted class name
            predicted_class = self.class_names[predicted_class_idx]
            
            # Get all class probabilities
            all_probabilities = []
            for i, class_name in enumerate(self.class_names):
                prob_percentage = preds[0][i] * 100
                all_probabilities.append({
                    'class': class_name,
                    'confidence': float(round(prob_percentage, 2))
                })
            
            # Sort by confidence
            all_probabilities.sort(key=lambda x: x['confidence'], reverse=True)
            
            logger.info(f"🔮 MobileNetV2 Prediction: {predicted_class} ({confidence:.2f}% confidence)")
            prob_strings = [f"{p['class']}: {p['confidence']:.1f}%" for p in all_probabilities]
            logger.info(f"📊 All probabilities: {prob_strings}")
            
            return {
                'predicted_class': predicted_class,
                'confidence': float(round(confidence, 2)),
                'all_probabilities': all_probabilities
            }
            
        except Exception as e:
            logger.error(f"❌ Prediction failed: {e}")
            return {
                'predicted_class': 'unknown',
                'confidence': float(0.0),
                'all_probabilities': []
            }
    
    def predict_from_gcs(self, gcs_url: str) -> Dict[str, Any]:
        """Make prediction using image from GCS URL"""
        try:
            # Download image directly to memory
            img_array = self._download_image_to_memory(gcs_url)
            
            # Make prediction using the image array
            if self.model is None:
                raise ValueError("Model not loaded")
            
            # Reshape for model input (add batch dimension) and scale like training
            img_array = self._preprocess(np.expand_dims(img_array, axis=0))

            # Make prediction
            predictions = self.model.predict(img_array, verbose=0)

            # Get the predicted class
            predicted_class_idx = np.argmax(predictions[0])
            confidence = float(predictions[0][predicted_class_idx]) * 100  # Convert to percentage
            predicted_class = self.class_names[predicted_class_idx]
            logger.info(
                f"🔮 Image prediction: {predicted_class} ({confidence:.1f}%) - "
                + ", ".join(f"{name}: {float(p) * 100:.1f}%" for name, p in zip(self.class_names, predictions[0]))
            )
            
            # Get all probabilities
            all_probabilities = []
            for i, prob in enumerate(predictions[0]):
                all_probabilities.append({
                    'class': self.class_names[i],
                    'confidence': float(prob) * 100  # Convert to percentage
                })
            
            # Sort by confidence
            all_probabilities.sort(key=lambda x: x['confidence'], reverse=True)
            
            return {
                'predicted_class': predicted_class,
                'confidence': confidence,
                'all_probabilities': all_probabilities
            }
                    
        except Exception as e:
            logger.error(f"❌ GCS prediction failed: {e}")
            return {
                'predicted_class': 'unknown',
                'confidence': float(0.0),
                'all_probabilities': []
            }
    
    def save_model(self, bucket, gcs_path: str) -> str:
        """Save ultra-lightweight MobileNetV2 model to GCS"""
        try:
            if not self.is_trained or not self.model:
                raise ValueError("No trained model to save")
            
            # Create lightweight metadata
            metadata = {
                'class_names': self.class_names,
                'img_size': self.img_size,
                'num_classes': len(self.class_names),
                'color_mode': 'rgb',
                'model_type': 'mobilenetv2_lightweight' if self.architecture == 'mobilenet' else 'efficientnet_b0',
                'architecture': self.architecture,
                'preprocessing': self.preprocessing,
                'trained_at': datetime.now(timezone.utc).isoformat()
            }
            
            # Helper function for upload with retry (string data)
            def upload_with_retry(blob, data, gcs_file_path, max_retries=5):
                """Upload to GCS with exponential backoff retry"""
                import time
                import random
                for attempt in range(max_retries):
                    try:
                        blob.upload_from_string(data, timeout=300)
                        return True
                    except Exception as upload_err:
                        if attempt < max_retries - 1:
                            wait_time = (2 ** attempt) + random.random()
                            logger.warning(f"⚠️ Upload attempt {attempt + 1} failed for {gcs_file_path}: {upload_err}")
                            time.sleep(wait_time)
                        else:
                            raise upload_err
                return False

            # Save metadata directly to GCS with retry
            metadata_gcs_path = f"{gcs_path}/metadata.json"
            metadata_blob = bucket.blob(metadata_gcs_path)
            upload_with_retry(metadata_blob, json.dumps(metadata, indent=2), metadata_gcs_path)
            logger.info(f"Uploaded metadata to {metadata_gcs_path}")

            # Save weights only (avoids Keras 3 / TF full-model serialization issues)
            model_gcs_prefix = f"{gcs_path}/saved_model"
            weights_path = tempfile.mktemp(suffix='.weights.h5')
            try:
                self.model.save_weights(weights_path)
                self.last_model_bytes = os.path.getsize(weights_path)
                with open(weights_path, 'rb') as f:
                    weights_data = f.read()
                weights_blob = bucket.blob(f"{model_gcs_prefix}.weights.h5")
                logger.info(f"📦 Uploading weights ({len(weights_data) / (1024*1024):.1f} MB)")
                upload_with_retry(weights_blob, weights_data, f"{model_gcs_prefix}.weights.h5")
                logger.info(f"Uploaded weights to {model_gcs_prefix}.weights.h5")
            finally:
                if os.path.exists(weights_path):
                    os.unlink(weights_path)
            
            logger.info(f"✅ Ultra-lightweight MobileNetV2 model saved to GCS: {gcs_path}")
            return gcs_path
            
        except Exception as e:
            logger.error(f"❌ Failed to save model: {e}")
            raise Exception(f"Failed to save model: {str(e)}")
    
    def load_model_from_gcs(self, bucket, gcs_path: str) -> bool:
        """Load ultra-lightweight MobileNetV2 model from GCS"""
        try:
            logger.info(f"Loading ultra-lightweight MobileNetV2 model from GCS path: {gcs_path}")
            
            # Load metadata first
            metadata_gcs_path = f"{gcs_path}/metadata.json"
            logger.info(f"Loading metadata from: {metadata_gcs_path}")
            metadata_blob = bucket.blob(metadata_gcs_path)
            metadata_data = metadata_blob.download_as_text()
            metadata = json.loads(metadata_data)
            logger.info(f"Metadata loaded: {metadata}")
            
            # Models saved before the model choice existed are MobileNet
            self.architecture = normalize_architecture(metadata.get('architecture'))
            self.img_size = tuple(metadata.get('img_size') or ARCHITECTURES[self.architecture]["img_size"])

            # Load main model (weights-only first, then SavedModel dir, then legacy .keras)
            model_gcs_prefix = f"{gcs_path}/saved_model"
            num_classes = len(metadata['class_names'])
            load_dir = tempfile.mkdtemp()
            temp_weights_path = tempfile.mktemp(suffix='.weights.h5')
            temp_keras_path = tempfile.mktemp(suffix='.keras')

            try:
                weights_blob = bucket.blob(f"{model_gcs_prefix}.weights.h5")
                if weights_blob.exists():
                    logger.info(f"Loading weights from {model_gcs_prefix}.weights.h5")
                    weights_blob.download_to_filename(temp_weights_path)
                    self._check_weights_file(temp_weights_path, num_classes)
                    self.model = self._build_model(num_classes, load_pretrained=False)
                    self.model.load_weights(temp_weights_path)
                else:
                    # SavedModel directory (legacy)
                    blobs = list(bucket.list_blobs(prefix=model_gcs_prefix + "/", max_results=1))
                    if blobs:
                        logger.info(f"Loading SavedModel from {model_gcs_prefix}/")
                        prefix_len = len(model_gcs_prefix) + 1
                        for blob in bucket.list_blobs(prefix=model_gcs_prefix + "/"):
                            rel = blob.name[prefix_len:].replace("/", os.sep)
                            local_path = os.path.join(load_dir, rel)
                            os.makedirs(os.path.dirname(local_path), exist_ok=True)
                            blob.download_to_filename(local_path)
                        self.model = keras.models.load_model(load_dir, compile=False)
                        self.model.compile(
                            optimizer=keras.optimizers.Adam(0.01),
                            loss="sparse_categorical_crossentropy",
                            metrics=["accuracy"],
                        )
                    else:
                        keras_blob = bucket.blob(f"{model_gcs_prefix}.keras")
                        if keras_blob.exists():
                            logger.info(f"Loading legacy .keras from {model_gcs_prefix}.keras")
                            keras_blob.download_to_filename(temp_keras_path)
                            self.model = keras.models.load_model(temp_keras_path, compile=False)
                            self.model.compile(
                                optimizer=keras.optimizers.Adam(0.01),
                                loss="sparse_categorical_crossentropy",
                                metrics=["accuracy"],
                            )
                        else:
                            raise FileNotFoundError(
                                f"No model found at {model_gcs_prefix}.weights.h5, "
                                f"{model_gcs_prefix}/, or {model_gcs_prefix}.keras"
                            )
            finally:
                if os.path.exists(load_dir):
                    shutil.rmtree(load_dir, ignore_errors=True)
                if os.path.exists(temp_weights_path):
                    os.unlink(temp_weights_path)
                if os.path.exists(temp_keras_path):
                    os.unlink(temp_keras_path)
            
            # Restore model state
            self.class_names = metadata['class_names']
            self.img_size = tuple(metadata['img_size'])
            # Models saved before 'preprocessing' was recorded were trained on pixels / 255
            self.preprocessing = metadata.get('preprocessing', PREPROCESSING_LEGACY_0_1)
            self.is_trained = True
            self.last_error = None

            # Log model info
            model_type = metadata.get('model_type', 'unknown')
            color_mode = metadata.get('color_mode', 'unknown')
            logger.info(f"Model loaded - Type: {model_type}, Color mode: {color_mode}, Preprocessing: {self.preprocessing}")

            logger.info(f"✅ Ultra-lightweight MobileNetV2 model loaded from GCS: {gcs_path}")
            return True

        except Exception as e:
            self.last_error = str(e)
            logger.error(f"❌ Failed to load model from GCS: {e}")
            logger.error(f"❌ Error type: {type(e)}")
            logger.error(f"❌ Error details: {str(e)}")
            return False

    @staticmethod
    def _check_weights_file(weights_path: str, num_classes: int):
        """Refuse weights files that hold no trained classifier.

        Models trained while the server had switched to tf_keras were saved with no layer
        weights at all; loading them silently gave 50/50 predictions for every image.
        """
        shapes = []
        with h5py.File(weights_path, 'r') as f:
            f.visititems(lambda name, obj: shapes.append(obj.shape) if isinstance(obj, h5py.Dataset) else None)
        if not any(len(shape) == 2 and shape[-1] == num_classes for shape in shapes):
            raise ValueError(
                "This image model was saved without its trained weights and can't make predictions. "
                "Please train the model again."
            )
    
    def update_firestore_training_status(self, project_id: str, session_id: str, status: str, 
                                       training_result: Optional[Dict[str, Any]] = None, 
                                       model_gcs_path: Optional[str] = None) -> bool:
        """Update Firestore with training status for a specific project and session"""
        try:
            from .config import gcp_clients
            db = gcp_clients.get_firestore_client()
            
            # Find the project document where createdBy contains the session_id
            projects_collection = db.collection('projects')
            query = projects_collection.where(filter=firestore.FieldFilter("createdBy", "==", f"guest:{session_id}")).where(filter=firestore.FieldFilter("id", "==", project_id)).limit(1)
            docs = list(query.stream())
            
            if not docs:
                logger.error(f"No project found with ID {project_id} for session {session_id}")
                return False
            
            doc_ref = docs[0].reference
            
            # Prepare update data
            update_data = {
                'updatedAt': datetime.now(timezone.utc)
            }
            
            if status == "training":
                update_data['status'] = "training"
                update_data['trainingStartedAt'] = datetime.now(timezone.utc)
            elif status == "completed":
                update_data['status'] = "trained"
                update_data['trainingCompletedAt'] = datetime.now(timezone.utc)
                
                if training_result:
                    update_data['model.accuracy'] = training_result.get('accuracy', 0.0)
                    update_data['model.loss'] = training_result.get('loss', 0.0)
                    update_data['model.labels'] = training_result.get('class_names', [])
                    update_data['model.numClasses'] = training_result.get('num_classes', 0)
                    update_data['model.trainedAt'] = datetime.now(timezone.utc)
                    
                if model_gcs_path:
                    update_data['model.gcsPath'] = model_gcs_path
                    update_data['model.filename'] = f"image_model_{project_id}"
                    # the chosen model; before the choice existed every image model was stored as "efficientnet"
                    update_data['model.modelType'] = (training_result or {}).get('architecture', DEFAULT_ARCHITECTURE)
                    if training_result and training_result.get('training_seconds') is not None:
                        update_data['model.trainingSeconds'] = training_result['training_seconds']
                    if training_result and training_result.get('model_bytes'):
                        update_data['model.sizeBytes'] = training_result['model_bytes']
                    update_data['model.endpointUrl'] = f"/api/guests/session/{session_id}/projects/{project_id}/predict"
                    
            elif status == "failed":
                update_data['status'] = "failed"
                update_data['trainingFailedAt'] = datetime.now(timezone.utc)
            
            # Update the document
            doc_ref.update(update_data)
            
            logger.info(f"✅ Updated Firestore for project {project_id} with status: {status}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to update Firestore: {e}")
            return False

    def clear_existing_model(self, bucket, gcs_path: str) -> bool:
        """Clear existing model from GCS to prevent shape mismatch issues"""
        try:
            # List all files in the GCS directory
            blobs = bucket.list_blobs(prefix=gcs_path)
            deleted_count = 0
            
            for blob in blobs:
                blob.delete()
                deleted_count += 1
                logger.info(f"Deleted {blob.name}")
            
            logger.info(f"✅ Cleared {deleted_count} files from {gcs_path}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to clear existing model: {e}")
            return False

    def clear_tensorflow_cache(self):
        """Clear TensorFlow model cache to avoid cached weight issues - DEPRECATED, use nuclear_tensorflow_reset"""
        logger.info("⚠️ Using legacy cache clear - consider using nuclear_tensorflow_reset()")
        self.nuclear_tensorflow_reset()

    def cleanup_temp_files(self, train_dir: str):
        """Clean up temporary training directory"""
        try:
            if os.path.exists(train_dir):
                shutil.rmtree(train_dir)
                logger.info(f"✅ Cleaned up temporary directory: {train_dir}")
        except Exception as e:
            logger.warning(f"⚠️ Failed to clean up temporary directory: {e}")


# Global trainer instance
image_trainer = ImageRecognitionTrainer()


# Loaded models for prediction, so a run of predictions (the Evaluate exam, the test set) does not
# download and rebuild the model for every image. Keyed by GCS path; a retrained model has a new
# metadata.json generation, so the cached one is replaced. Small LRU: models are 2-16 MB each.
import threading
from collections import OrderedDict

_PREDICTORS: "OrderedDict[str, Tuple[int, ImageRecognitionTrainer]]" = OrderedDict()
_PREDICTORS_LOCK = threading.Lock()
_PREDICTORS_MAX = 8


def get_cached_predictor(bucket, gcs_path: str) -> ImageRecognitionTrainer:
    blob = bucket.get_blob(f"{gcs_path}/metadata.json")
    if blob is None:
        raise FileNotFoundError(f"No image model at {gcs_path}")
    with _PREDICTORS_LOCK:
        hit = _PREDICTORS.get(gcs_path)
        if hit and hit[0] == blob.generation:
            _PREDICTORS.move_to_end(gcs_path)
            return hit[1]
    predictor = ImageRecognitionTrainer()
    if not predictor.load_model_from_gcs(bucket, gcs_path):
        raise RuntimeError(predictor.last_error or "Could not load the image model")
    with _PREDICTORS_LOCK:
        _PREDICTORS[gcs_path] = (blob.generation, predictor)
        _PREDICTORS.move_to_end(gcs_path)
        while len(_PREDICTORS) > _PREDICTORS_MAX:
            _PREDICTORS.popitem(last=False)
    return predictor