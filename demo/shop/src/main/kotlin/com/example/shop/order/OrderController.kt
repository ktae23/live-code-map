package com.example.shop.order

import com.example.shop.order.dto.OrderResponse
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/orders")
class OrderController(
    private val orderService: OrderService,
) {
    @GetMapping("/{id}")
    fun getOrder(@PathVariable id: Long): OrderResponse =
        OrderResponse.from(orderService.getOrder(id))

    @GetMapping
    fun myOrders(@RequestParam userId: Long): List<OrderResponse> =
        orderService.findByUser(userId).map(OrderResponse::from)

    @DeleteMapping("/{id}/legacy")
    fun cancelLegacy(@PathVariable id: Long) {
        orderService.cancel(id)
    }
}
