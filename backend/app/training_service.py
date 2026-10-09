import joblib
import pickle
from typing import List, Dict, Any, Tuple, Optional
from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split, cross_val_score, GridSearchCV
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
import numpy as np
from datetime import datetime, timezone
import re
import spacy
import logging

# Configure logging
logger = logging.getLogger(__name__)

# Global variable for spaCy model (lazy loaded)
_nlp_model = None

def get_spacy_model():
    """Lazy load spaCy model - only loads when first needed"""
    global _nlp_model
    
    if _nlp_model is None:
        try:
            logger.info("Loading spaCy English model...")
            _nlp_model = spacy.load("en_core_web_sm")
            logger.info("✅ spaCy English model loaded successfully")
        except OSError:
            logger.warning("📥 spaCy English model not found, attempting to download...")
            try:
                import subprocess
                import sys
                subprocess.check_call([sys.executable, "-m", "spacy", "download", "en_core_web_sm"], 
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                _nlp_model = spacy.load("en_core_web_sm")
                logger.info("✅ spaCy English model downloaded and loaded successfully")
            except Exception as e:
                logger.error(f"❌ Failed to download spaCy model: {e}")
                logger.warning("🔧 spaCy model not available - some features may be limited")
                _nlp_model = None
    
    return _nlp_model

# Import models - maintain backward compatibility
try:
    from .models import TextExample, TrainedModel
except ImportError:
    # Define minimal classes for standalone usage
    class TextExample:
        def __init__(self, text: str, label: str):
            self.text = text
            self.label = label
    
    class TrainedModel:
        pass


class EnhancedTextPreprocessor:
    """Enhanced text preprocessing using spaCy for better feature extraction"""
    
    def __init__(self):
        self.nlp = None  # Will be loaded lazily
        self._spacy_available = False
        
        # Custom stop words for better text classification
        self.custom_stops = {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those'
        }
    
    def _ensure_spacy_loaded(self):
        """Ensure spaCy model is loaded when needed"""
        if self.nlp is None:
            self.nlp = get_spacy_model()
            self._spacy_available = self.nlp is not None
    
    def clean_text(self, text: str) -> str:
        """Clean and normalize text"""
        if not isinstance(text, str):
            return ""
        
        # Convert to lowercase
        text = text.lower()
        
        # Remove special characters and numbers (keep apostrophes for contractions)
        text = re.sub(r'[^a-zA-Z\s\']', ' ', text)
        
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        
        return text
    
    def tokenize_and_clean(self, text: str) -> List[str]:
        """Tokenize and clean text using spaCy if available, fallback to basic tokenization"""
        try:
            # Clean text first
            cleaned_text = self.clean_text(text)
            
            # Try to use spaCy if available
            self._ensure_spacy_loaded()
            
            if self._spacy_available and self.nlp:
                logger.debug(f"🔍 Processing text with spaCy: '{text[:50]}...'")
                
                # Process with spaCy
                doc = self.nlp(cleaned_text)
                
                # Extract tokens with advanced filtering
                filtered_tokens = []
                for token in doc:
                    # Skip stop words, punctuation, whitespace, and very short tokens
                    if (not token.is_stop and 
                        not token.is_punct and 
                        not token.is_space and 
                        len(token.text) > 2 and
                        token.text.lower() not in self.custom_stops):
                        
                        # Lemmatize the token
                        lemmatized = token.lemma_.lower()
                        filtered_tokens.append(lemmatized)
                
                logger.debug(f"✅ spaCy processing complete: {len(filtered_tokens)} filtered tokens")
                return filtered_tokens
            else:
                # Fallback to basic tokenization without spaCy
                logger.debug("⚠️ spaCy not available, using basic tokenization")
                return self._basic_tokenize(cleaned_text)
            
        except Exception as e:
            logger.error(f"❌ Error in tokenize_and_clean: {e}")
            logger.warning("⚠️ Falling back to basic tokenization")
            return self._basic_tokenize(self.clean_text(text))
    
    def _basic_tokenize(self, text: str) -> List[str]:
        """Basic tokenization fallback when spaCy is not available"""
        # Simple word splitting and filtering
        tokens = text.split()
        filtered_tokens = []
        
        for token in tokens:
            # Basic filtering
            if (len(token) > 2 and 
                token.lower() not in self.custom_stops and
                token.isalpha()):
                filtered_tokens.append(token.lower())
        
        return filtered_tokens
    
    def preprocess_text(self, text: str) -> str:
        """Preprocess text for vectorization"""
        tokens = self.tokenize_and_clean(text)
        return ' '.join(tokens)


class EnhancedLogisticRegressionTrainer:
    """Enhanced training service for logistic regression text classification"""
    
    def __init__(self):
        self.preprocessor = EnhancedTextPreprocessor()
        
        # Enhanced TF-IDF vectorizer with better parameters
        self.tfidf_vectorizer = TfidfVectorizer(
            max_features=5000,  # Increased features for better representation
            stop_words=None,  # We handle stop words in preprocessing
            ngram_range=(1, 3),  # Unigrams, bigrams, and trigrams
            min_df=2,  # Minimum document frequency (ignore very rare terms)
            max_df=0.9,  # Maximum document frequency (ignore very common terms)
            sublinear_tf=True,  # Apply sublinear tf scaling
            use_idf=True,  # Use inverse document frequency
            smooth_idf=True,  # Smooth idf weights
            norm='l2'  # L2 normalization
        )
        
        # Enhanced logistic regression with better default parameters
        self.base_model = LogisticRegression(
            max_iter=2000,  # Increased iterations
            random_state=42,
            solver='liblinear',  # Good for small datasets
            warm_start=True,  # Enable warm start for better convergence
            class_weight='balanced'  # Handle class imbalance
        )
        
        # Create pipeline for better preprocessing
        self.pipeline = Pipeline([
            ('vectorizer', self.tfidf_vectorizer),
            ('classifier', self.base_model)
        ])
        
        # Store training data for exact match checking (NEW FEATURE)
        self.training_texts = []
        self.training_labels = []
        self.is_trained = False
    
    def preprocess_data(self, examples: List[TextExample]) -> Tuple[List[str], List[str]]:
        """Extract and preprocess texts and labels from examples"""
        texts = []
        labels = []
        
        for example in examples:
            # Handle both TextExample objects and dict format
            if hasattr(example, 'text') and hasattr(example, 'label'):
                text = example.text
                label = example.label
            elif isinstance(example, dict) and 'text' in example and 'label' in example:
                text = example['text']
                label = example['label']
            else:
                continue
            
            # Preprocess text
            processed_text = self.preprocessor.preprocess_text(text)
            if processed_text.strip():  # Only include non-empty processed texts
                texts.append(processed_text)
                labels.append(label)
        
        return texts, labels
    
    def validate_dataset(self, examples: List[TextExample]) -> Tuple[bool, str]:
        """Validate dataset for training"""
        if not examples:
            return False, "No examples provided"
        
        # Check minimum examples per label
        label_counts = {}
        for example in examples:
            if hasattr(example, 'label'):
                label = example.label
            elif isinstance(example, dict) and 'label' in example:
                label = example['label']
            else:
                continue
            label_counts[label] = label_counts.get(label, 0) + 1
        
        min_examples_per_label = 2  # Minimum required for training
        max_examples_per_label = 10000
        
        for label, count in label_counts.items():
            if count < min_examples_per_label:
                return False, f"Label '{label}' has only {count} examples. Minimum required is {min_examples_per_label}"
            if count > max_examples_per_label:
                return False, f"Label '{label}' has {count} examples. Maximum allowed is {max_examples_per_label}"
        
        return True, "Dataset is valid"
    
    def find_best_hyperparameters(self, X_train: List[str], y_train: List[str]) -> Dict[str, Any]:
        """Find optimal hyperparameters using grid search"""
        print("🔍 Finding optimal hyperparameters...")
        
        # Define parameter grid for TF-IDF
        tfidf_params = {
            'vectorizer__max_features': [3000, 5000, 7000],
            'vectorizer__ngram_range': [(1, 2), (1, 3)],
            'vectorizer__min_df': [1, 2],
            'vectorizer__max_df': [0.8, 0.9, 0.95]
        }
        
        # Define parameter grid for classifier
        classifier_params = {
            'classifier__C': [0.1, 1.0, 10.0, 100.0],
            'classifier__class_weight': ['balanced', None]
        }
        
        # Combine parameter grids
        param_grid = {**tfidf_params, **classifier_params}
        
        # Use 3-fold cross-validation for hyperparameter tuning
        grid_search = GridSearchCV(
            self.pipeline,
            param_grid,
            cv=3,
            scoring='accuracy',
            n_jobs=-1,  # Use all available cores
            verbose=1
        )
        
        # Fit grid search
        grid_search.fit(X_train, y_train)
        
        print(f"✅ Best parameters: {grid_search.best_params_}")
        print(f"✅ Best cross-validation score: {grid_search.best_score_:.4f}")
        
        return {
            'best_params': grid_search.best_params_,
            'best_score': grid_search.best_score_,
            'best_estimator': grid_search.best_estimator_
        }
    
    def train_model(self, examples: List[TextExample]) -> Dict[str, Any]:
        """Train a logistic regression model on text examples"""
        try:
            print("🚀 Starting model training...")
            print(f"📊 Training with {len(examples)} examples")
            
            # Validate dataset
            print("🔍 Validating dataset...")
            is_valid, validation_message = self.validate_dataset(examples)
            if not is_valid:
                raise ValueError(validation_message)
            print("✅ Dataset validation passed")
            
            # Preprocess data
            print("🔧 Preprocessing training data...")
            try:
                texts, labels = self.preprocess_data(examples)
                print(f"✅ Preprocessing complete: {len(texts)} processed texts, {len(labels)} labels")
            except Exception as preprocess_error:
                print(f"❌ Preprocessing failed: {preprocess_error}")
                raise Exception(f"Data preprocessing failed: {str(preprocess_error)}")
            
            # Store training data for exact match checking (NEW FEATURE)
            self.training_texts = texts[:]
            self.training_labels = labels[:]
            
            # Use all data for training (no validation split as requested)
            print("📚 Using all data for training (no validation split)...")
            X_train = texts
            y_train = labels
            print(f"✅ Training data ready: {len(X_train)} examples")
            
            # Find best hyperparameters
            print("🔍 Finding best hyperparameters...")
            try:
                best_params = self.find_best_hyperparameters(X_train, y_train)
                print("✅ Hyperparameter optimization complete")
            except Exception as hp_error:
                print(f"❌ Hyperparameter optimization failed: {hp_error}")
                print("⚠️ Using default parameters")
                best_params = None
            
            # Train final model
            print("🎯 Training final model...")
            if best_params and 'best_estimator' in best_params:
                best_pipeline = best_params['best_estimator']
            else:
                best_pipeline = self.pipeline
            
            # Train final model with best parameters
            print("🎯 Training final model with best parameters...")
            best_pipeline.fit(X_train, y_train)
            
            # Evaluate model on training data
            y_pred = best_pipeline.predict(X_train)
            accuracy = accuracy_score(y_train, y_pred)
            
            print(f"✅ Training complete! Training accuracy: {accuracy:.4f}")
            
            # Get feature names and importance
            feature_names = best_pipeline.named_steps['vectorizer'].get_feature_names_out()
            unique_labels = list(set(labels))
            
            # Mark as trained
            self.is_trained = True
            
            # Create result dictionary (MAINTAIN OLD API FORMAT)
            result = {
                'accuracy': accuracy,
                'labels': unique_labels,
                'training_examples': len(X_train),
                'total_features': len(feature_names),
                'model': best_pipeline  # This is the key field the API expects
            }
            
            print("🎉 Training completed successfully!")
            return result
            
        except Exception as e:
            print(f"❌ Training failed: {e}")
            import traceback
            traceback.print_exc()
            raise Exception(f"Model training failed: {str(e)}")
    
    def predict(self, text: str, model_path: str) -> Dict[str, Any]:
        """Make prediction using saved model with enhanced exact matching"""
        try:
            # Load model
            with open(model_path, 'rb') as f:
                model_data = pickle.load(f)
            
            # Handle different model formats
            if isinstance(model_data, dict):
                if 'pipeline' in model_data:
                    model = model_data['pipeline']
                    training_texts = model_data.get('training_texts', [])
                    training_labels = model_data.get('training_labels', [])
                else:
                    # Old format compatibility
                    vectorizer = model_data.get('vectorizer')
                    model = model_data.get('model')
                    if vectorizer and model:
                        # Reconstruct pipeline
                        model = Pipeline([
                            ('vectorizer', vectorizer),
                            ('classifier', model)
                        ])
                    training_texts = []
                    training_labels = []
            else:
                # Very old format - direct model object
                model = model_data
                training_texts = []
                training_labels = []
            
            # Preprocess input text
            processed_text = self.preprocessor.preprocess_text(text)
            
            # Check for exact match in training data (NEW FEATURE)
            if training_texts and training_labels:
                for i, training_text in enumerate(training_texts):
                    if processed_text == training_text:
                        exact_label = training_labels[i]
                        return {
                            'label': exact_label,
                            'confidence': 100.0,  # 100% confidence for exact matches
                            'alternatives': []
                        }
            
            # Make prediction with model
            if hasattr(model, 'predict'):
                # Pipeline format
                prediction = model.predict([processed_text])[0]
                probabilities = model.predict_proba([processed_text])[0]
                classes = model.classes_
            else:
                # Handle legacy format
                text_vector = vectorizer.transform([processed_text])
                prediction = model.predict(text_vector)[0]
                probabilities = model.predict_proba(text_vector)[0]
                classes = model.classes_
            
            # Get confidence and alternatives
            confidence = max(probabilities) * 100
            alternatives = []
            
            for i, (label, prob) in enumerate(zip(classes, probabilities)):
                if label != prediction:
                    alternatives.append({
                        'label': label,
                        'confidence': round(prob * 100, 2)
                    })
            
            # Sort alternatives by confidence
            alternatives.sort(key=lambda x: x['confidence'], reverse=True)
            
            return {
                'label': prediction,
                'confidence': round(confidence, 2),
                'alternatives': alternatives[:2]  # Top 2 alternatives
            }
            
        except Exception as e:
            logger.error(f"❌ Prediction failed: {str(e)}")
            return {
                'label': 'unknown',
                'confidence': 0.0,
                'alternatives': []
            }
    
    def predict_from_gcs(self, text: str, bucket, gcs_path: str) -> Dict[str, Any]:
        """Make prediction using model stored in GCS with enhanced exact matching"""
        try:
            # Download model from GCS
            blob = bucket.blob(gcs_path)
            model_bytes = blob.download_as_bytes()
            
            # Deserialize model data
            model_data = pickle.loads(model_bytes)
            
            # Handle different model formats
            if isinstance(model_data, dict):
                if 'pipeline' in model_data:
                    pipeline = model_data['pipeline']
                    training_texts = model_data.get('training_texts', [])
                    training_labels = model_data.get('training_labels', [])
                else:
                    # Legacy format
                    raise ValueError("Model format not supported - only complete trained pipelines are supported")
            else:
                # Very old format
                pipeline = model_data
                training_texts = []
                training_labels = []
            
            # Preprocess input text
            processed_text = self.preprocessor.preprocess_text(text)
            
            # Check for exact match in training data (NEW FEATURE)
            if training_texts and training_labels:
                for i, training_text in enumerate(training_texts):
                    if processed_text == training_text:
                        exact_label = training_labels[i]
                        return {
                            'label': exact_label,
                            'confidence': 100.0,  # 100% confidence for exact matches
                            'alternatives': []
                        }
            
            # Make prediction using the pipeline
            prediction = pipeline.predict([processed_text])[0]
            probabilities = pipeline.predict_proba([processed_text])[0]
            
            # Get confidence and alternatives
            confidence = max(probabilities) * 100
            alternatives = []
            
            # Get class labels from the pipeline
            classes = pipeline.classes_
            
            for i, (label, prob) in enumerate(zip(classes, probabilities)):
                if label != prediction:
                    alternatives.append({
                        'label': label,
                        'confidence': round(prob * 100, 2)
                    })
            
            # Sort alternatives by confidence
            alternatives.sort(key=lambda x: x['confidence'], reverse=True)
            
            return {
                'label': prediction,
                'confidence': round(confidence, 2),
                'alternatives': alternatives[:2]  # Top 2 alternatives
            }
            
        except Exception as e:
            raise Exception(f"Failed to load model from GCS: {str(e)}")
    
    def save_model(self, model_path: str) -> str:
        """Save trained model and vectorizer with training data"""
        if not self.is_trained:
            raise ValueError("No trained model to save")
        
        # Get the trained pipeline from the last training
        # This assumes the model was stored after training
        model_data = {
            'pipeline': self.pipeline,  # Save the complete pipeline
            'training_texts': self.training_texts,  # NEW: For exact matching
            'training_labels': self.training_labels,  # NEW: For exact matching
            'trained_at': datetime.now(timezone.utc).isoformat()
        }
        
        with open(model_path, 'wb') as f:
            pickle.dump(model_data, f)
        
        return model_path
    
    def save_model_to_gcs(self, bucket, gcs_path: str, trained_pipeline) -> str:
        """Save trained model directly to GCS with training data"""
        import time
        import random
        
        if trained_pipeline is None:
            raise ValueError("Trained pipeline is required - cannot save untrained models")
        
        # Save the complete trained pipeline with training data
        model_data = {
            'pipeline': trained_pipeline,  # Save the complete trained pipeline
            'training_texts': self.training_texts,  # NEW: For exact matching
            'training_labels': self.training_labels,  # NEW: For exact matching
            'trained_at': datetime.now(timezone.utc).isoformat()
        }
        
        # Serialize model data
        model_bytes = pickle.dumps(model_data)
        
        # Upload to GCS with retry logic
        blob = bucket.blob(gcs_path)
        max_retries = 5
        
        for attempt in range(max_retries):
            try:
                blob.upload_from_string(model_bytes, content_type='application/octet-stream', timeout=120)
                return gcs_path
            except Exception as upload_err:
                if attempt < max_retries - 1:
                    wait_time = (2 ** attempt) + random.random()
                    logger.warning(f"⚠️ Upload attempt {attempt + 1} failed: {upload_err}")
                    logger.info(f"   Retrying in {wait_time:.1f} seconds...")
                    time.sleep(wait_time)
                else:
                    logger.error(f"❌ All {max_retries} upload attempts failed for {gcs_path}")
                    raise upload_err
        
        return gcs_path


# Global trainer instance - MAINTAIN OLD API COMPATIBILITY
trainer = EnhancedLogisticRegressionTrainer()


# ============================================================================
# DISTILBERT TRAINER - Enhanced Text Classification with Transformers
# ============================================================================

class DistilBERTTrainer:
    """DistilBERT-based text classification trainer with same interface as Logistic Regression"""
    
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.class_names = []
        self.label_to_id = {}
        self.id_to_label = {}
        self.training_texts = []
        self.training_labels = []
        self.is_trained = False
        
    def validate_dataset(self, examples: List[TextExample]) -> Tuple[bool, str]:
        """Validate dataset for training"""
        if not examples or len(examples) < 2:
            return False, "Need at least 2 examples for training"
        
        labels = [ex.label for ex in examples]
        unique_labels = set(labels)
        
        if len(unique_labels) < 2:
            return False, "Need at least 2 different labels for classification"
        
        # Check minimum examples per label (5 as per requirement)
        label_counts = {label: labels.count(label) for label in unique_labels}
        min_count = min(label_counts.values())
        if min_count < 5:
            return False, f"Each label needs at least 5 examples. Minimum found: {min_count}"
        
        return True, "Dataset is valid"
    
    def train_model(self, examples: List[TextExample]) -> Dict[str, Any]:
        """Train DistilBERT model on text examples"""
        try:
            logger.info("🚀 Starting DistilBERT model training...")
            logger.info(f"📊 Training with {len(examples)} examples")
            
            # Validate dataset
            logger.info("🔍 Validating dataset...")
            is_valid, validation_message = self.validate_dataset(examples)
            if not is_valid:
                raise ValueError(validation_message)
            logger.info("✅ Dataset validation passed")
            
            # Extract texts and labels
            texts = [ex.text for ex in examples]
            labels = [ex.label for ex in examples]
            
            # Store training data for exact match checking
            self.training_texts = texts[:]
            self.training_labels = labels[:]
            
            # Get unique labels and create mappings
            self.class_names = sorted(list(set(labels)))
            self.label_to_id = {label: idx for idx, label in enumerate(self.class_names)}
            self.id_to_label = {idx: label for label, idx in self.label_to_id.items()}
            num_labels = len(self.class_names)
            
            logger.info(f"📋 Found {num_labels} classes: {self.class_names}")
            
            # Import transformers
            from transformers import (
                AutoTokenizer, 
                AutoModelForSequenceClassification,
                TrainingArguments,
                Trainer,
                DataCollatorWithPadding
            )
            from torch.utils.data import Dataset
            import torch
            
            # Load tokenizer and model with retry logic and HF token support
            logger.info("📥 Loading DistilBERT tokenizer and model...")
            model_name = "distilbert-base-uncased"
            
            # Retry logic for model loading (handles rate limiting)
            import time
            import random
            max_retries = 5
            
            def load_tokenizer_with_retry():
                # First try to load from cache (no download needed - works without token)
                try:
                    logger.info("🔍 Trying to load tokenizer from cache...")
                    tokenizer = AutoTokenizer.from_pretrained(model_name, local_files_only=True)
                    logger.info("✅ Tokenizer loaded from cache")
                    return tokenizer
                except Exception as cache_error:
                    logger.info(f"📥 Tokenizer not in cache, will download: {str(cache_error)[:50]}...")
                    # If not cached, download with retry logic
                    for attempt in range(max_retries):
                        try:
                            tokenizer = AutoTokenizer.from_pretrained(
                                model_name,
                                local_files_only=False  # Allow download if not cached
                            )
                            logger.info("✅ Tokenizer downloaded and loaded")
                            return tokenizer
                        except Exception as e:
                            if attempt < max_retries - 1:
                                wait_time = (2 ** attempt) + random.random() * 2  # Exponential backoff with jitter
                                logger.warning(f"⚠️ Tokenizer download attempt {attempt + 1} failed: {str(e)[:100]}...")
                                logger.info(f"   Retrying in {wait_time:.1f} seconds...")
                                time.sleep(wait_time)
                            else:
                                logger.error(f"❌ All {max_retries} tokenizer download attempts failed")
                                raise
            
            def load_model_with_retry(num_labels):
                # First try to load from cache (no download needed - works without token)
                try:
                    logger.info("🔍 Trying to load model from cache...")
                    model = AutoModelForSequenceClassification.from_pretrained(
                        model_name,
                        num_labels=num_labels,
                        local_files_only=True  # Use cached model if available
                    )
                    logger.info("✅ Model loaded from cache")
                    return model
                except Exception as cache_error:
                    logger.info(f"📥 Model not in cache, will download: {str(cache_error)[:50]}...")
                    # If not cached, download with retry logic
                    for attempt in range(max_retries):
                        try:
                            model = AutoModelForSequenceClassification.from_pretrained(
                                model_name,
                                num_labels=num_labels,
                                local_files_only=False  # Allow download if not cached
                            )
                            logger.info("✅ Model downloaded and loaded")
                            return model
                        except Exception as e:
                            if attempt < max_retries - 1:
                                wait_time = (2 ** attempt) + random.random() * 2  # Exponential backoff with jitter
                                logger.warning(f"⚠️ Model download attempt {attempt + 1} failed: {str(e)[:100]}...")
                                logger.info(f"   Retrying in {wait_time:.1f} seconds...")
                                time.sleep(wait_time)
                            else:
                                logger.error(f"❌ All {max_retries} model download attempts failed")
                                raise
            
            # Load with retry logic
            self.tokenizer = load_tokenizer_with_retry()
            self.model = load_model_with_retry(num_labels)
            logger.info("✅ DistilBERT model loaded successfully")
            
            # Create dataset class
            class TextDataset(Dataset):
                def __init__(self, texts, labels, tokenizer, label_to_id):
                    self.texts = texts
                    self.labels = [label_to_id[label] for label in labels]
                    self.tokenizer = tokenizer
                
                def __len__(self):
                    return len(self.texts)
                
                def __getitem__(self, idx):
                    text = str(self.texts[idx])
                    label = self.labels[idx]
                    encoding = self.tokenizer(
                        text,
                        truncation=True,
                        padding='max_length',
                        max_length=128,  # Keep 128 for better accuracy (standard for DistilBERT)
                        return_tensors='pt'
                    )
                    return {
                        'input_ids': encoding['input_ids'].flatten(),
                        'attention_mask': encoding['attention_mask'].flatten(),
                        'labels': torch.tensor(label, dtype=torch.long)
                    }
            
            # Create datasets
            train_dataset = TextDataset(texts, labels, self.tokenizer, self.label_to_id)
            
            # Training arguments - optimized for ~1 minute training with good accuracy
            training_args = TrainingArguments(
                output_dir='./distilbert_results',
                num_train_epochs=4,  # 4 epochs - good balance of speed and accuracy
                per_device_train_batch_size=16,  # Larger batch size for faster training (fewer steps)
                learning_rate=2e-5,  # Standard learning rate for good accuracy
                weight_decay=0.01,
                logging_dir='./logs',
                logging_steps=50,  # Less frequent logging for speed
                save_strategy='no',  # Don't save checkpoints
                eval_strategy='no',  # No validation split
                load_best_model_at_end=False,
                dataloader_num_workers=0,  # Disable multiprocessing (can cause issues in threads)
                disable_tqdm=False,  # Keep progress bar
                report_to=None,  # Disable wandb/tensorboard reporting
            )
            
            # Data collator
            data_collator = DataCollatorWithPadding(tokenizer=self.tokenizer)
            
            # Create trainer
            trainer = Trainer(
                model=self.model,
                args=training_args,
                train_dataset=train_dataset,
                data_collator=data_collator,
            )
            
            # Train model
            logger.info("🎯 Training DistilBERT model...")
            trainer.train()
            logger.info("✅ Training complete!")
            
            # Evaluate on training data
            logger.info("📊 Evaluating model on training data...")
            self.model.eval()
            correct = 0
            total = 0
            
            with torch.no_grad():
                for item in train_dataset:
                    input_ids = item['input_ids'].unsqueeze(0)
                    attention_mask = item['attention_mask'].unsqueeze(0)
                    label = item['labels'].item()
                    
                    outputs = self.model(input_ids=input_ids, attention_mask=attention_mask)
                    predicted = torch.argmax(outputs.logits, dim=-1).item()
                    
                    if predicted == label:
                        correct += 1
                    total += 1
            
            accuracy = correct / total if total > 0 else 0.0
            logger.info(f"✅ Training accuracy: {accuracy:.4f}")
            
            # Mark as trained
            self.is_trained = True
            
            # Return result in same format as Logistic Regression
            result = {
                'accuracy': accuracy,
                'labels': self.class_names,
                'training_examples': len(texts),
                'total_features': self.model.config.vocab_size,
                'model': self.model,  # Return the trained model
                'tokenizer': self.tokenizer  # Also return tokenizer
            }
            
            logger.info("🎉 DistilBERT training completed successfully!")
            return result
            
        except Exception as e:
            logger.error(f"❌ DistilBERT training failed: {e}")
            import traceback
            traceback.print_exc()
            raise Exception(f"DistilBERT model training failed: {str(e)}")
    
    def save_model_to_gcs(self, bucket, gcs_path: str, trained_model, tokenizer) -> str:
        """Save DistilBERT model to GCS using Hugging Face save_pretrained format"""
        import tempfile
        import os
        import json
        
        try:
            if trained_model is None or tokenizer is None:
                raise ValueError("Trained model and tokenizer are required")
            
            # Hugging Face requires local file path, so we use temp dir as staging area
            # All files are immediately uploaded to GCS cloud storage
            temp_dir = tempfile.mkdtemp()
            try:
                logger.info(f"📦 Staging model files locally (required by Hugging Face), uploading to cloud immediately...")
                
                # Save model and tokenizer using Hugging Face format (requires local path)
                try:
                    trained_model.save_pretrained(temp_dir, safe_serialization=True)
                    logger.info("✅ Model staged locally")
                except Exception as model_save_error:
                    logger.error(f"❌ Error staging model: {model_save_error}")
                    raise
                
                try:
                    tokenizer.save_pretrained(temp_dir)
                    logger.info("✅ Tokenizer staged locally")
                except Exception as tokenizer_save_error:
                    logger.error(f"❌ Error staging tokenizer: {tokenizer_save_error}")
                    raise
                
                # Save metadata to memory (will upload directly to cloud)
                metadata = {
                    'class_names': self.class_names,
                    'label_to_id': self.label_to_id,
                    'id_to_label': self.id_to_label,
                    'training_texts': self.training_texts,
                    'training_labels': self.training_labels,
                    'trained_at': datetime.now(timezone.utc).isoformat(),
                    'model_type': 'distilbert'
                }
                
                # Save metadata temporarily for upload
                metadata_path = os.path.join(temp_dir, 'metadata.json')
                with open(metadata_path, 'w') as f:
                    json.dump(metadata, f, indent=2)
                
                # Upload all files directly to GCS cloud storage with retry logic
                logger.info(f"☁️ Uploading all files directly to cloud storage: {gcs_path}")
                uploaded_files = []
                
                def upload_with_retry(blob, file_content, gcs_file_path, max_retries=5):
                    """Upload file to GCS with exponential backoff retry"""
                    import time
                    import random
                    
                    for attempt in range(max_retries):
                        try:
                            # Set timeout for large files (10 min for model weights)
                            blob.upload_from_string(
                                file_content,
                                timeout=600,  # 10 minute timeout
                                retry=None  # Disable built-in retry, we handle it ourselves
                            )
                            return True
                        except Exception as upload_err:
                            if attempt < max_retries - 1:
                                # Exponential backoff with jitter: 2^attempt + random(0-1)
                                wait_time = (2 ** attempt) + random.random()
                                logger.warning(f"⚠️ Upload attempt {attempt + 1} failed for {gcs_file_path}: {upload_err}")
                                logger.info(f"   Retrying in {wait_time:.1f} seconds...")
                                time.sleep(wait_time)
                            else:
                                logger.error(f"❌ All {max_retries} upload attempts failed for {gcs_file_path}")
                                raise upload_err
                    return False
                
                for root, dirs, files in os.walk(temp_dir):
                    for file in files:
                        local_path = os.path.join(root, file)
                        file_size = os.path.getsize(local_path)
                        
                        # Read file content and upload directly to cloud
                        with open(local_path, 'rb') as f:
                            file_content = f.read()
                        
                        # Get relative path from temp_dir
                        rel_path = os.path.relpath(local_path, temp_dir)
                        # Use forward slashes for GCS
                        gcs_file_path = f"{gcs_path}/{rel_path}".replace('\\', '/')
                        
                        # Upload with retry logic
                        blob = bucket.blob(gcs_file_path)
                        
                        # Log file size for large files
                        if file_size > 1024 * 1024:  # > 1MB
                            logger.info(f"  📦 Uploading large file: {file} ({file_size / (1024*1024):.1f} MB)")
                        
                        upload_with_retry(blob, file_content, gcs_file_path)
                        uploaded_files.append(gcs_file_path)
                        logger.info(f"  ☁️ Uploaded to cloud: {gcs_file_path}")
                
                logger.info(f"✅ All files saved to cloud storage ({len(uploaded_files)} files)")
                
                return gcs_path
            except Exception as upload_error:
                logger.error(f"❌ Error during upload to cloud: {upload_error}")
                raise
            finally:
                # Immediately clean up temporary staging directory (everything is now in cloud)
                import shutil
                try:
                    if os.path.exists(temp_dir):
                        shutil.rmtree(temp_dir, ignore_errors=True)
                        logger.info(f"🧹 Removed temporary staging directory (all files in cloud)")
                except Exception as cleanup_error:
                    logger.warning(f"⚠️ Failed to clean up temp directory: {cleanup_error}")
                
        except Exception as e:
            logger.error(f"❌ Failed to save DistilBERT model to GCS: {e}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
            raise Exception(f"Failed to save DistilBERT model: {str(e)}")
    
    def predict_from_gcs(self, text: str, bucket, gcs_path: str) -> Dict[str, Any]:
        """Make prediction using DistilBERT model stored in GCS"""
        import tempfile
        import os
        import json
        import torch
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        
        try:
            # Create temporary directory for downloading model
            with tempfile.TemporaryDirectory() as temp_dir:
                logger.info(f"📥 Downloading DistilBERT model from GCS: {gcs_path}")
                
                # List all files in the GCS directory
                blobs = bucket.list_blobs(prefix=gcs_path)
                downloaded_files = []
                
                for blob in blobs:
                    # Get relative path
                    rel_path = blob.name.replace(gcs_path + '/', '')
                    if rel_path:  # Skip if it's the directory itself
                        local_path = os.path.join(temp_dir, rel_path)
                        # Create directory if needed
                        os.makedirs(os.path.dirname(local_path), exist_ok=True)
                        # Download file
                        blob.download_to_filename(local_path)
                        downloaded_files.append(rel_path)
                        logger.info(f"  ✅ Downloaded: {rel_path}")
                
                if not downloaded_files:
                    raise ValueError(f"No model files found in GCS path: {gcs_path}")
                
                # Load metadata
                metadata_path = os.path.join(temp_dir, 'metadata.json')
                if os.path.exists(metadata_path):
                    with open(metadata_path, 'r') as f:
                        metadata = json.load(f)
                    class_names = metadata.get('class_names', [])
                    training_texts = metadata.get('training_texts', [])
                    training_labels = metadata.get('training_labels', [])
                    id_to_label = metadata.get('id_to_label', {})
                else:
                    raise ValueError("metadata.json not found in model directory")
                
                # Check for exact match in training data
                processed_text = text.lower().strip()
                if training_texts and training_labels:
                    for i, training_text in enumerate(training_texts):
                        if processed_text == training_text.lower().strip():
                            exact_label = training_labels[i]
                            return {
                                'label': exact_label,
                                'confidence': 100.0,  # 100% confidence for exact matches
                                'alternatives': []
                            }
                
                # Load model and tokenizer
                logger.info("🔄 Loading DistilBERT model and tokenizer...")
                self.tokenizer = AutoTokenizer.from_pretrained(temp_dir)
                self.model = AutoModelForSequenceClassification.from_pretrained(temp_dir)
                self.model.eval()
                logger.info("✅ Model loaded successfully")
                
                # Tokenize input text
                inputs = self.tokenizer(
                    text,
                    truncation=True,
                    padding='max_length',
                    max_length=128,  # Keep 128 for accuracy (matches training)
                    return_tensors='pt'
                )
                
                # Make prediction
                with torch.no_grad():
                    outputs = self.model(**inputs)
                    logits = outputs.logits
                    
                    # Apply softmax to get probabilities
                    probabilities = torch.nn.functional.softmax(logits, dim=-1)[0]
                    probabilities_np = probabilities.cpu().numpy()
                
                # Get predicted class
                predicted_id = int(torch.argmax(probabilities, dim=-1).item())
                predicted_label = id_to_label.get(predicted_id, class_names[predicted_id] if predicted_id < len(class_names) else 'unknown')
                
                # Calculate confidence (same as Logistic Regression: max probability * 100)
                confidence = float(probabilities_np[predicted_id]) * 100
                
                # Get alternatives (all other classes)
                alternatives = []
                for i, prob in enumerate(probabilities_np):
                    if i != predicted_id:
                        label = id_to_label.get(i, class_names[i] if i < len(class_names) else f'class_{i}')
                        alternatives.append({
                            'label': label,
                            'confidence': round(float(prob) * 100, 2)
                        })
                
                # Sort alternatives by confidence
                alternatives.sort(key=lambda x: x['confidence'], reverse=True)
                
                return {
                    'label': predicted_label,
                    'confidence': round(confidence, 2),
                    'alternatives': alternatives[:2]  # Top 2 alternatives
                }
                
        except Exception as e:
            logger.error(f"❌ Failed to load/predict with DistilBERT model: {e}")
            import traceback
            traceback.print_exc()
            raise Exception(f"Failed to load/predict with DistilBERT model: {str(e)}")


# Global DistilBERT trainer instance
distilbert_trainer = DistilBERTTrainer()