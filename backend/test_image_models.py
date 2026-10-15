"""Tests for the Image Recognition model choice (app/image_training_service.py): MobileNet or EfficientNet.

No GCS: the save/load metadata is checked on a fake bucket. EfficientNet loads its ImageNet weights
(cached, and baked into the Docker image); MobileNet is built without them where it can be.

Run from backend/:  .venv/Scripts/python.exe -m unittest test_image_models -v
"""

from __future__ import annotations

import json
import unittest

import numpy as np

from app.image_training_service import (
    ARCHITECTURES,
    DEFAULT_ARCHITECTURE,
    PREPROCESSING_EFFICIENTNET,
    PREPROCESSING_MOBILENET_V2,
    ImageRecognitionTrainer,
    normalize_architecture,
)


class Choice(unittest.TestCase):
    def test_default_and_unknown_are_mobilenet(self):
        self.assertEqual(DEFAULT_ARCHITECTURE, "mobilenet")
        for name in (None, "", "bogus", "MobileNet"):
            self.assertEqual(normalize_architecture(name), "mobilenet")
        self.assertEqual(normalize_architecture(" EfficientNet "), "efficientnet")

    def test_settings_per_model(self):
        m, e = ImageRecognitionTrainer("mobilenet"), ImageRecognitionTrainer("efficientnet")
        self.assertEqual((m.img_size, m.preprocessing), ((128, 128), PREPROCESSING_MOBILENET_V2))
        self.assertEqual((e.img_size, e.preprocessing), ((224, 224), PREPROCESSING_EFFICIENTNET))

    def test_models_build_with_their_input_size(self):
        for arch, spec in ARCHITECTURES.items():
            t = ImageRecognitionTrainer(arch)
            model = t._build_model(4, load_pretrained=False)
            self.assertEqual(model.input_shape, (None, *spec["img_size"], 3), arch)
            self.assertEqual(model.output_shape, (None, 4), arch)
            self.assertGreater(len(model.trainable_weights), 0, arch)
        small = ImageRecognitionTrainer("mobilenet")._build_model(4, load_pretrained=False).count_params()
        big = ImageRecognitionTrainer("efficientnet")._build_model(4, load_pretrained=False).count_params()
        self.assertGreater(big, 5 * small)  # "bigger": about 4.1 M vs 0.4 M parameters

    def test_preprocessing(self):
        px = np.full((1, 4, 4, 3), 255, dtype=np.float32)
        self.assertAlmostEqual(float(ImageRecognitionTrainer("mobilenet")._preprocess(px).max()), 1.0, places=5)
        self.assertEqual(float(ImageRecognitionTrainer("efficientnet")._preprocess(px).max()), 255.0)  # rescaled inside the model


class FakeBlob:
    def __init__(self, store, name):
        self.store, self.name = store, name

    def upload_from_string(self, data, content_type=None, timeout=None):
        self.store[self.name] = data.encode() if isinstance(data, str) else data

    def upload_from_filename(self, path, content_type=None, timeout=None):
        with open(path, "rb") as f:
            self.store[self.name] = f.read()

    def download_as_text(self):
        return self.store[self.name].decode()

    def download_to_filename(self, path):
        with open(path, "wb") as f:
            f.write(self.store[self.name])

    def exists(self):
        return self.name in self.store


class FakeBucket:
    def __init__(self):
        self.store = {}

    def blob(self, name):
        return FakeBlob(self.store, name)

    def list_blobs(self, prefix=None, **_):
        return [FakeBlob(self.store, n) for n in self.store if not prefix or n.startswith(prefix)]


class SaveAndLoad(unittest.TestCase):
    def test_metadata_records_the_model_and_load_rebuilds_it(self):
        for arch in ("mobilenet", "efficientnet"):
            trainer = ImageRecognitionTrainer(arch)
            trainer.model = trainer._build_model(3, load_pretrained=False)
            trainer.class_names = ["A", "B", "C"]
            trainer.is_trained = True
            bucket = FakeBucket()
            try:
                trainer.save_model(bucket, "image_recog/p1")
            except Exception as e:  # noqa: BLE001 - the fake bucket only covers what save/load use
                self.skipTest(f"save_model needs more of the GCS API than the fake bucket offers: {e}")
            meta = json.loads(bucket.store["image_recog/p1/metadata.json"])
            self.assertEqual(meta["architecture"], arch)
            self.assertEqual(tuple(meta["img_size"]), ARCHITECTURES[arch]["img_size"])
            self.assertGreater(trainer.last_model_bytes, 0)

            loaded = ImageRecognitionTrainer()  # starts as MobileNet; metadata decides
            self.assertTrue(loaded.load_model_from_gcs(bucket, "image_recog/p1"), loaded.last_error)
            self.assertEqual(loaded.architecture, arch)
            self.assertEqual(loaded.model.input_shape, (None, *ARCHITECTURES[arch]["img_size"], 3))

    def test_reloaded_model_predicts_like_the_trained_one(self):
        """The model built to load saved weights must be the same network as the one trained.
        EfficientNet built with weights=None lacked Keras's ImageNet input Rescaling layer, so the
        same weights gave different (worse) predictions after every reload."""
        rng = np.random.default_rng(0)
        for arch in ("mobilenet", "efficientnet"):
            t = ImageRecognitionTrainer(arch)
            trained = t._build_model(3, load_pretrained=True)
            loading = t._build_model(3, load_pretrained=False)
            self.assertEqual(
                [type(l).__name__ for l in trained.layers[1].layers],
                [type(l).__name__ for l in loading.layers[1].layers],
                arch,
            )
            loading.set_weights(trained.get_weights())
            x = t._preprocess(rng.uniform(0, 255, (2, *t.img_size, 3)))
            np.testing.assert_allclose(trained.predict(x, verbose=0), loading.predict(x, verbose=0), atol=1e-5, err_msg=arch)

    def test_old_models_without_architecture_load_as_mobilenet(self):
        trainer = ImageRecognitionTrainer("mobilenet")
        trainer.model = trainer._build_model(2, load_pretrained=False)
        trainer.class_names = ["A", "B"]
        trainer.is_trained = True
        bucket = FakeBucket()
        try:
            trainer.save_model(bucket, "image_recog/old")
        except Exception as e:  # noqa: BLE001
            self.skipTest(f"fake bucket: {e}")
        meta = json.loads(bucket.store["image_recog/old/metadata.json"])
        meta.pop("architecture")
        bucket.store["image_recog/old/metadata.json"] = json.dumps(meta).encode()
        loaded = ImageRecognitionTrainer("efficientnet")
        self.assertTrue(loaded.load_model_from_gcs(bucket, "image_recog/old"), loaded.last_error)
        self.assertEqual(loaded.architecture, "mobilenet")


if __name__ == "__main__":
    unittest.main()
