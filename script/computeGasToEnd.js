#!/usr/bin/env node

const RPC_ENDPOINT = "http://localhost:8545"

const path = require("path")
const web3 = new (require("web3"))(RPC_ENDPOINT)
web3.eth.debug = new (require("web3-eth-debug").Debug)(web3.eth.currentProvider)

if (process.argv.length !== 3) {
  console.error(`Usage: ${path.basename(process.argv[1])} <attack_tx_hash>`)
  process.exit(1)
}

(async () => {
  let poolAddress
  let tx
  try {
    const TX_SIGNATURE = "0x6cf39c2b"
    const GOVERNOR_ABI = [
      {
        constant: true,
        inputs: [
          { internalType: "uint256", name: "_listID", type: "uint256" },
          { internalType: "uint256", name: "_transactionIndex", type: "uint256" }
        ],
        name: "getTransactionInfo",
        outputs: [
          { internalType: "address", name: "target", type: "address" },
          { internalType: "uint256", name: "value", type: "uint256" },
          { internalType: "bytes", name: "data", type: "bytes" },
          { internalType: "bool", name: "executed", type: "bool" }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
      }
    ]
    const RECOVERER_ABI = [
      {
        inputs: [],
        name: "bpool",
        outputs: [{ internalType: "contract BPool", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
      }
    ]

    tx = await web3.eth.getTransaction(process.argv[2])

    // Check tx
    if (tx.input.substr(0, 10) !== TX_SIGNATURE) {
      console.error("Wrong transaction signature")
      process.exit(1)
    }

    const Governor = new web3.eth.Contract(GOVERNOR_ABI, tx.to)
    const attackTx = await Governor.methods
      .getTransactionInfo(0, tx.input[2 + 2 * (4 + 0x20 * 3) - 1] - 1)
      .call()

    const Recoverer = new web3.eth.Contract(RECOVERER_ABI, attackTx.target)
    poolAddress = await Recoverer.methods.bpool().call()
  } catch (error) {
    console.error(`RPC should be running at ${RPC_ENDPOINT}`)
    console.error("  See 'npm run test:ganache-cli'")
    console.error("  See 'npm run test:truffle'")
    console.error(error)
    process.exit(1)
  }

  const trace = await web3.eth.debug.getTransactionTrace(process.argv[2], {
    disableStorage: true
  })

  const logs = trace.structLogs

  // Infer context
  let contextStack = [tx.to]
  let currentDepth = 0
  for (const log of logs) {
    if (log.depth < currentDepth) contextStack.splice(log.depth + 1)

    log.context = contextStack[contextStack.length - 1]

    if (log.op === "CALL" || log.op === "STATICCALL")
      contextStack.push(
        web3.utils.toChecksumAddress("0x" + log.stack[log.stack.length - 2].substr(24))
      )
    currentDepth = log.depth
  }

  // Record last log
  const lastLog = logs[logs.length - 1]

  // Get index of last call to swapExactAmountIn
  logs.reverse()
  const lastIterationCallIndex =
    logs.length -
    logs.findIndex((log) => {
      if (log.op !== "CALL") return false

      const target = web3.utils.toChecksumAddress("0x" + log.stack[log.stack.length - 2].substr(24))
      if (target !== poolAddress) return false

      const memFrom = Number("0x" + log.stack[log.stack.length - 4])
      const sig = "0x" + log.memory.join("").substr(2 * memFrom, 8)
      return sig === "0x8201aa3f" // swapExactAmountIn signature
    }) -
    1
  logs.reverse()

  // Map code run before getting out of the loop
  let opcodesBlacklist = new Map()
  for (let i = 0; i < lastIterationCallIndex; i++) {
    const log = logs[i]
    opcodesBlacklist.set(log.context + "|" + log.pc, true)
  }

  // Find first opcode outside the loop
  logs.splice(0, lastIterationCallIndex)
  const logOutIndex = logs.findIndex((log) => !opcodesBlacklist.has(log.context + "|" + log.pc))

  // Find last GAS opcode before leaving the loop (gasleft())
  logs.splice(logOutIndex)
  logs.reverse()
  const gasLog = logs.find((log) => log.op === "GAS")

  console.log("Gas used from the loop's last `gasleft()` call to end of transaction:")
  console.log("  This includes return to caller (Governor)")
  console.log("  Remember caller still holds 1/64th of the gas it had before its call")
  console.dir(lastLog.gas - gasLog.gas + lastLog.gasCost)
})()
