
#include <Arduino.h>

void setup() {
    delay(2000);
    Serial.begin(115200);
}

void loop() {

    /* When not touching the pin, baseline value is ~12k.
      When touching the pin with the five on it the value
      spikes well above 15k+.
    */
    int value = touchRead(5);
    Serial.print("Touch value: ");
    Serial.println(value);
    delay(150);
}