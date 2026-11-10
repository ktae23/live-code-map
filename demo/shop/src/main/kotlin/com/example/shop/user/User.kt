package com.example.shop.user

import jakarta.persistence.*

@Entity
@Table(name = "users")
class User(
    val name: String,
) {
    @Id
    @GeneratedValue
    val id: Long = 0
}
