package com.example.shop.payment;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class PaymentService {

    private final PaymentGateway paymentGateway;
    private final PaymentHistoryRepository paymentHistoryRepository;

    public PaymentResult charge(Long userId, long amount) {
        PaymentResult result = paymentGateway.request(userId, amount);
        paymentHistoryRepository.save(PaymentHistory.of(userId, result));
        return result;
    }

    @Deprecated
    public void legacyCharge(Long userId, long amount) {
        paymentGateway.requestLegacy(userId, amount);
    }
}
