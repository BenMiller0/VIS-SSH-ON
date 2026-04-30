#include "soc/gpio_struct.h"
#include "esp_rom_sys.h"

#define LED_PIN 13

// Bare metal C code to blink LED
extern "C" void app_main(void) {
    esp_rom_delay_us(2000000); // <---- DO NOT DELETE
    
    // Un-comment code to remotely make LED blink!
    /*
    GPIO.enable_w1ts = (1 << LED_PIN);
    while (1) {
        GPIO.out_w1ts = (1 << LED_PIN);
        esp_rom_delay_us(900000);
        GPIO.out_w1tc = (1 << LED_PIN);
        esp_rom_delay_us(900000);
    }
    */
}