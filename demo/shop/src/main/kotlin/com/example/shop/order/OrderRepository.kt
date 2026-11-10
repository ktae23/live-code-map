package com.example.shop.order

import com.example.shop.user.User
import org.springframework.data.jpa.repository.JpaRepository

interface OrderRepository : JpaRepository<Order, Long> {
    fun findAllByUser(user: User): List<Order>
}
