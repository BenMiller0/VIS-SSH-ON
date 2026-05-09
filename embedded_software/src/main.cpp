#include "soc/gpio_struct.h"
#include "esp_rom_sys.h"
#include "esp_rom_uart.h"
#include "../vis_ssh_on/vis_ssh_on.hpp"

#define LED_PIN 13

vis_ssh_on vis;

extern "C" void app_main(void) {
    esp_rom_delay_us(2000000); // DO NOT DELETE

    // Configure GPIO13 as output
    GPIO.enable_w1ts = (1 << LED_PIN);

    esp_rom_printf("Starting LED blink program...\n");

    while (1) {
        vis.test_out("LED ON\n");
        GPIO.out_w1ts = (1 << LED_PIN);

        esp_rom_delay_us(900000);

        vis.test_out("LED OFF\n");
        GPIO.out_w1tc = (1 << LED_PIN);

        esp_rom_delay_us(900000);
    }
}