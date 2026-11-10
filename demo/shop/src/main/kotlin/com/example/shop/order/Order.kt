package com.example.shop.order

import com.example.shop.user.User
import jakarta.persistence.*

@Entity
@Table(name = "orders")
class Order(
    @ManyToOne(fetch = FetchType.LAZY)
    val user: User,
    var amount: Long,
) {
    @Id
    @GeneratedValue
    val id: Long = 0

    @Enumerated(EnumType.STRING)
    var status: OrderStatus = OrderStatus.CREATED
        private set

    fun cancel() {
        status = OrderStatus.CANCELED
    }
}
