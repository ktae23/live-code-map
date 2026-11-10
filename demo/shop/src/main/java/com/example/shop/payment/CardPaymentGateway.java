package com.example.shop.payment;

import org.springframework.stereotype.Component;

@Component
public class CardPaymentGateway implements PaymentGateway {

    @Override
    public PaymentResult request(Long userId, long amount) {
        return new PaymentResult("card-" + userId, true);
    }

    @Override
    public void requestLegacy(Long userId, long amount) {
        throw new UnsupportedOperationException("legacy");
    }
}
