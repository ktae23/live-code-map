// 데모: Claude가 "주문 결제 기능"을 만드는 흐름을 실제 파일 수정으로 흉내 낸다.
// 수정은 파일에 직접 쓰고, 화면 반영은 서버의 파일 감시가 잡는다(실제 사용과 같은 경로).
import fs from 'node:fs';
import path from 'node:path';

const K = 'src/main/kotlin/com/example/shop';
const J = 'src/main/java/com/example/shop';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let running = false;
let baseDir = null;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// 작업 폴더를 원본과 똑같이 맞춘다(폴더 자체는 지우지 않는다 — 감시가 끊기지 않게)
export function syncWorkspace(base, work) {
  baseDir = base;
  fs.mkdirSync(work, { recursive: true });
  const want = new Set(walk(base).map((p) => path.relative(base, p)));
  for (const p of walk(work)) if (!want.has(path.relative(work, p))) fs.rmSync(p);
  for (const rel of want) {
    const from = path.join(base, rel), to = path.join(work, rel);
    const src = fs.readFileSync(from, 'utf8');
    if (!fs.existsSync(to) || fs.readFileSync(to, 'utf8') !== src) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, src);
    }
  }
}

function edit(root, rel, find, replace) {
  const abs = path.join(root, rel);
  const src = fs.readFileSync(abs, 'utf8');
  if (!src.includes(find)) throw new Error(`데모 수정 실패: ${rel}에서 찾지 못함\n${find}`);
  fs.writeFileSync(abs, src.replace(find, replace));
}

const STEPS = [
  {
    file: `${K}/order/OrderService.kt`,
    run: (r, f) => edit(r, f,
      'import com.example.shop.user.UserRepository',
      'import com.example.shop.payment.PaymentService\nimport com.example.shop.user.UserRepository'),
    wait: 500,
  },
  {
    file: `${K}/order/OrderService.kt`,
    run: (r, f) => edit(r, f,
      '    private val userRepository: UserRepository,\n',
      '    private val userRepository: UserRepository,\n    private val paymentService: PaymentService,\n'),
  },
  {
    file: `${K}/order/OrderService.kt`,
    intentless: true,
    run: (r, f) => edit(r, f,
      '        getOrder(id).cancel()\n    }\n',
      `        getOrder(id).cancel()
    }

    @Transactional
    fun pay(id: Long): Order {
        val order = getOrder(id)
        val result = paymentService.charge(order.user.id, order.amount)
        order.markPaid(result.transactionId())
        return order
    }
`),
  },
  {
    file: `${K}/order/Order.kt`,
    run: (r, f) => edit(r, f,
      '        private set\n\n    fun cancel() {',
      `        private set

    var transactionId: String? = null
        private set

    fun markPaid(transactionId: String) {
        check(status == OrderStatus.CREATED) { "결제할 수 없는 주문이에요" }
        this.transactionId = transactionId
        status = OrderStatus.PAID
    }

    fun cancel() {`),
  },
  {
    file: `${K}/order/Order.kt`,
    intentless: true,
    run: (r, f) => edit(r, f,
      '    fun cancel() {\n        status = OrderStatus.CANCELED',
      '    fun cancel() {\n        check(status != OrderStatus.PAID) { "결제된 주문은 환불로 처리해요" }\n        status = OrderStatus.CANCELED'),
  },
  {
    file: `${K}/order/OrderStatus.kt`,
    run: (r, f) => edit(r, f, '    CREATED,\n', '    CREATED,\n    PAID,\n'),
  },
  {
    file: `${J}/payment/PaymentService.java`,
    run: (r, f) => edit(r, f,
      `
    @Deprecated
    public void legacyCharge(Long userId, long amount) {
        paymentGateway.requestLegacy(userId, amount);
    }
`, ''),
  },
  {
    file: `${J}/payment/PaymentService.java`,
    intentless: true,
    run: (r, f) => edit(r, f,
      '        PaymentResult result = paymentGateway.request(userId, amount);\n',
      '        PaymentResult result = paymentGateway.request(userId, amount);\n        if (!result.approved()) {\n            throw new PaymentDeclinedException(userId);\n        }\n'),
  },
  {
    file: `${J}/payment/PaymentGateway.java`,
    run: (r, f) => edit(r, f, '\n    void requestLegacy(Long userId, long amount);\n', ''),
  },
  {
    file: `${J}/payment/CardPaymentGateway.java`,
    run: (r, f) => edit(r, f,
      `
    @Override
    public void requestLegacy(Long userId, long amount) {
        throw new UnsupportedOperationException("legacy");
    }
`, ''),
  },
  {
    file: `${K}/order/dto/PayOrderResponse.kt`,
    run: (r, f) => fs.writeFileSync(path.join(r, f), `package com.example.shop.order.dto

import com.example.shop.order.Order
import com.example.shop.order.OrderStatus

data class PayOrderResponse(
    val orderId: Long,
    val status: OrderStatus,
    val transactionId: String,
) {
    companion object {
        fun from(order: Order) = PayOrderResponse(order.id, order.status, order.transactionId!!)
    }
}
`),
  },
  {
    file: `${K}/order/OrderController.kt`,
    run: (r, f) => edit(r, f,
      `
    @DeleteMapping("/{id}/legacy")
    fun cancelLegacy(@PathVariable id: Long) {
        orderService.cancel(id)
    }
`, `
    @PostMapping("/{id}/pay")
    fun pay(@PathVariable id: Long): PayOrderResponse =
        PayOrderResponse.from(orderService.pay(id))
`),
  },
  {
    file: `${K}/order/OrderController.kt`,
    intentless: true,
    run: (r, f) => edit(r, f,
      'import com.example.shop.order.dto.OrderResponse',
      'import com.example.shop.order.dto.OrderResponse\nimport com.example.shop.order.dto.PayOrderResponse'),
    wait: 600,
  },
  {
    file: `${K}/order/OrderService.kt`,
    run: (r, f) => edit(r, f,
      'orderRepository.findById(id).orElseThrow { OrderNotFoundException(id) }',
      'orderRepository.findByIdOrNull(id) ?: throw OrderNotFoundException(id)'),
  },
];

export async function runScenario(session, root) {
  if (running) return;
  running = true;
  try {
    syncWorkspace(baseDir, root);
    await sleep(800);
    session.startTurn('주문에 결제 기능 붙여줘. 레거시 결제 코드는 정리하고');
    await sleep(1400);
    for (const step of STEPS) {
      const exists = fs.existsSync(path.join(root, step.file));
      if (exists && !step.intentless) {
        session.intent(step.file);
        await sleep(1000);
      }
      step.run(root, step.file);
      await sleep(step.wait ?? 1600);
    }
    await sleep(600);
    session.endTurn();
  } finally {
    running = false;
  }
}
