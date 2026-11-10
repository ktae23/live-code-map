package com.example.shop.order

import com.example.shop.user.UserRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional(readOnly = true)
class OrderService(
    private val orderRepository: OrderRepository,
    private val userRepository: UserRepository,
) {
    fun getOrder(id: Long): Order =
        orderRepository.findById(id).orElseThrow { OrderNotFoundException(id) }

    fun findByUser(userId: Long): List<Order> {
        val user = userRepository.getReferenceById(userId)
        return orderRepository.findAllByUser(user)
    }

    @Transactional
    fun cancel(id: Long) {
        getOrder(id).cancel()
    }
}
