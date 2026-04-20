#include <Arduino.h>
constexpr int LED_PIN = 13;

void setup() {
    delay(2000); // <---- DO NOT DELETE
    Serial.begin(115200);
    pinMode(LED_PIN, OUTPUT);
}

void loop() {
    // uncomment the code below and upload it to the ESP 32 to make it blink, remotely!
    // Build and compile with: pio run -t upload
    /*
	digitalWrite(LED_PIN, HIGH);  
    delay(900);
    digitalWrite(LED_PIN, LOW);
    delay(900);
    */
}
