#!/usr/bin/env python3
"""
Enhanced test script for the enhanced training service with fan control examples
"""

import sys
import os
import tempfile
import pickle
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import the enhanced trainer from your training service
from training_service import EnhancedLogisticRegressionTrainer, TextExample

def test_fan_control_training():
    """Test the enhanced training service with fan control examples"""
    print("🧪 Testing Enhanced Fan Control Training Service")
    print("=" * 50)
    
    # Create trainer instance
    trainer = EnhancedLogisticRegressionTrainer()
    
    # Fan control examples - convert to TextExample objects
    example_data = [
        # Fan On - Hot/Cooling Context
        {"text": "Turn on the fan", "label": "fan_on"},
        {"text": "Man its hot", "label": "fan_on"},
        {"text": "Can we make this cooler", "label": "fan_on"},
        {"text": "Turn on the fan", "label": "fan_on"},
        {"text": "Fan on please", "label": "fan_on"},
        {"text": "It's very hot", "label": "fan_on"},
        {"text": "Too hot in here", "label": "fan_on"},
        {"text": "Need cooling", "label": "fan_on"},
        {"text": "Temperature is high", "label": "fan_on"},
        {"text": "Burning up", "label": "fan_on"},
        {"text": "Warm weather", "label": "fan_on"},
        
        # Fan Off - Cold Context
        {"text": "Turn off the fan", "label": "fan_off"},
        {"text": "Off the fan please", "label": "fan_off"},
        {"text": "Too cold", "label": "fan_off"},
        {"text": "Fan off", "label": "fan_off"},
        {"text": "Amazing chill", "label": "fan_off"},
        {"text": "So cold please switch of the fan", "label": "fan_off"},
        {"text": "Oh God why is it so cold", "label": "fan_off"},
        {"text": "Freezing in here", "label": "fan_off"},
        {"text": "Need to warm up", "label": "fan_off"},
        {"text": "Temperature is low", "label": "fan_off"},
        {"text": "Cool breeze", "label": "fan_off"},
        {"text": "Icy cold", "label": "fan_off"}
    ]
    
    # Convert to TextExample objects
    examples = [TextExample(text=item["text"], label=item["label"]) for item in example_data]
    
    print(f"📊 Training with {len(examples)} examples:")
    print(f"   Fan On: {len([e for e in examples if e.label == 'fan_on'])} examples")
    print(f"   Fan Off: {len([e for e in examples if e.label == 'fan_off'])} examples")
    print()
    
    # Train the model
    print("🚀 Training model...")
    try:
        result = trainer.train_model(examples)
        
        print(f"✅ Training successful!")
        print(f"📝 Labels: {result['labels']}")
        print(f"📊 Training Examples: {result['training_examples']}")
        print(f"📊 Validation Examples: {result['validation_examples']}")
        print(f"📊 Training Accuracy: {result['accuracy']:.4f}")
        print(f"📊 Total Features: {result['total_features']}")
        
        # Save the trained model to a temporary file
        temp_model_path = tempfile.mktemp(suffix='.pkl')
        
        # Save model with the trained pipeline
        model_data = {
            'pipeline': result['model'],
            'training_texts': trainer.training_texts,
            'training_labels': trainer.training_labels,
            'trained_at': '2024-test'
        }
        
        with open(temp_model_path, 'wb') as f:
            pickle.dump(model_data, f)
        
        print(f"💾 Model saved to: {temp_model_path}")
        
        # Test predictions on training examples
        print("\n🧪 Testing predictions on training examples...")
        test_texts = [
            "Turn on the fan",           # Exact training example
            "Turn off the fan",          # Exact training example
            "Man its hot",               # Exact training example
            "Too cold",                  # Exact training example
            "Fan on please",             # Exact training example
            "Fan off",                   # Exact training example
            "It's burning hot in here",  # New text - should predict fan_on
            "I'm freezing cold",         # New text - should predict fan_off
        ]
        
        correct_predictions = 0
        total_predictions = len(test_texts)
        
        for test_text in test_texts:
            prediction = trainer.predict(test_text, temp_model_path)
            
            # Determine expected label
            expected_label = None
            lower_text = test_text.lower()
            
            # Simple rule-based expected label determination
            if any(word in lower_text for word in ["on", "hot", "burning", "warm", "cooler", "cooling"]):
                expected_label = "fan_on"
            elif any(word in lower_text for word in ["off", "cold", "freezing", "chill", "icy"]):
                expected_label = "fan_off"
            
            is_correct = expected_label == prediction['label']
            if is_correct:
                correct_predictions += 1
            
            status = "✅" if is_correct else "❌"
            exact_match_info = " (EXACT MATCH)" if prediction['confidence'] == 100.0 else ""
            
            print(f"📝 Text: '{test_text}'")
            print(f"🎯 Prediction: {prediction['label']}")
            print(f"📊 Expected: {expected_label}")
            print(f"📊 Confidence: {prediction['confidence']:.2f}%{exact_match_info}")
            
            # Show alternatives if available
            if prediction['alternatives']:
                print(f"📋 Alternatives:")
                for alt in prediction['alternatives']:
                    print(f"   - {alt['label']}: {alt['confidence']:.2f}%")
            
            print(f"📊 Status: {status}")
            print("-" * 50)
        
        # Calculate and display testing accuracy
        testing_accuracy = correct_predictions / total_predictions
        print(f"\n" + "="*50)
        print(f"📊 FINAL TESTING ACCURACY: {testing_accuracy * 100:.2f}%")
        print(f"📊 Correct Predictions: {correct_predictions}/{total_predictions}")
        print(f"📊 Accuracy Status: {'✅ PERFECT' if testing_accuracy == 1.0 else '⚠️ NEEDS IMPROVEMENT'}")
        print("="*50)
        
        # Test some edge cases
        print("\n🔍 Testing Edge Cases...")
        print("=" * 50)
        
        edge_cases = [
            "fan",              # Just the word "fan"
            "temperature",      # Just "temperature"
            "weather is nice",  # Neutral weather
            "hello world",      # Unrelated text
            "hot fan on",       # Multiple keywords
        ]
        
        for text in edge_cases:
            if not text.strip():
                print(f"📝 Text: '(empty string)'")
                print("⚠️ Skipping empty text")
                print("-" * 30)
                continue
                
            prediction = trainer.predict(text, temp_model_path)
            exact_match_info = " (EXACT MATCH)" if prediction['confidence'] == 100.0 else ""
            
            print(f"📝 Text: '{text}'")
            print(f"🎯 Prediction: {prediction['label']}")
            print(f"📊 Confidence: {prediction['confidence']:.2f}%{exact_match_info}")
            
            # Show alternatives if available
            if prediction['alternatives']:
                print(f"📋 Alternatives:")
                for alt in prediction['alternatives']:
                    print(f"   - {alt['label']}: {alt['confidence']:.2f}%")
            
            print("-" * 30)
        
        # Interactive testing
        print("\n🔍 Interactive Testing - Enter your own text!")
        print("=" * 50)
        print("Type 'quit', 'exit', or 'q' to stop")
        
        while True:
            try:
                user_text = input("\nEnter text to test: ").strip()
                
                if user_text.lower() in ['quit', 'exit', 'q']:
                    print("👋 Goodbye!")
                    break
                
                if not user_text:
                    print("⚠️ Please enter some text!")
                    continue
                
                # Get prediction
                prediction = trainer.predict(user_text, temp_model_path)
                
                exact_match_info = " (EXACT MATCH)" if prediction['confidence'] == 100.0 else ""
                print(f"\n🎯 Result for: '{user_text}'")
                print(f"📊 Predicted Label: {prediction['label']}")
                print(f"📊 Confidence: {prediction['confidence']:.2f}%{exact_match_info}")
                
                # Show alternatives if available
                if prediction['alternatives']:
                    print(f"📋 Alternative Predictions:")
                    for alt in prediction['alternatives']:
                        print(f"   - {alt['label']}: {alt['confidence']:.2f}%")
                    
            except KeyboardInterrupt:
                print("\n\n👋 Goodbye!")
                break
            except Exception as e:
                print(f"❌ Error: {e}")
        
        # Cleanup
        try:
            os.unlink(temp_model_path)
            print(f"\n🧹 Cleaned up temporary model file")
        except:
            pass
    
    except Exception as e:
        print(f"❌ Training failed: {str(e)}")
        import traceback
        traceback.print_exc()

def test_direct_pipeline_prediction():
    """Test predictions using the trained pipeline directly (without saving to file)"""
    print("\n🧪 Testing Direct Pipeline Predictions")
    print("=" * 50)
    
    trainer = EnhancedLogisticRegressionTrainer()
    
    # Simple examples for quick testing
    examples = [
        TextExample("Turn on the fan", "fan_on"),
        TextExample("It's hot", "fan_on"),
        TextExample("Turn off the fan", "fan_off"),
        TextExample("Too cold", "fan_off"),
        TextExample("Fan on please", "fan_on"),
        TextExample("Fan off", "fan_off"),
    ]
    
    # Train model
    result = trainer.train_model(examples)
    trained_pipeline = result['model']
    
    # Test predictions directly with the pipeline
    test_texts = ["It's very hot", "Freezing cold", "Turn on fan"]
    
    for text in test_texts:
        processed_text = trainer.preprocessor.preprocess_text(text)
        
        # Direct prediction
        prediction = trained_pipeline.predict([processed_text])[0]
        probabilities = trained_pipeline.predict_proba([processed_text])[0]
        confidence = max(probabilities) * 100
        
        print(f"📝 Text: '{text}'")
        print(f"🔧 Processed: '{processed_text}'")
        print(f"🎯 Prediction: {prediction}")
        print(f"📊 Confidence: {confidence:.2f}%")
        print("-" * 30)

if __name__ == "__main__":
    test_fan_control_training()
    test_direct_pipeline_prediction()