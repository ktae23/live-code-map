package com.example.shop.payment;

public interface PaymentGateway {

    PaymentResult request(Long userId, long amount);

    void requestLegacy(Long userId, long amount);
}
