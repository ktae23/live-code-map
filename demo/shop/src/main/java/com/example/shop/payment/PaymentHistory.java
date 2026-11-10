package com.example.shop.payment;

import jakarta.persistence.*;

@Entity
public class PaymentHistory {

    @Id
    @GeneratedValue
    private Long id;

    private Long userId;

    private String transactionId;

    protected PaymentHistory() {
    }

    public static PaymentHistory of(Long userId, PaymentResult result) {
        PaymentHistory h = new PaymentHistory();
        h.userId = userId;
        h.transactionId = result.transactionId();
        return h;
    }
}
