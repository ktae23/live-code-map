package com.example.shop.order.dto

import com.example.shop.order.Order
import com.example.shop.order.OrderStatus

data class OrderResponse(
    val id: Long,
    val amount: Long,
    val status: OrderStatus,
) {
    companion object {
        fun from(order: Order) = OrderResponse(order.id, order.amount, order.status)
    }
}
