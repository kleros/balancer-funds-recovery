const KlerosLiquid = artifacts.require("xKlerosLiquid")
const PnkToken = artifacts.require("xMiniMeToken")
const Recoverer = artifacts.require("BalancerPoolRecoverer")
const Governor = artifacts.require("xMockGovernor")

module.exports = function (deployer) {
  const logTx = require("./utils/logTx")([Governor]).bind({ web3: web3 })

  const web3KlerosLiquid = new web3.eth.Contract(KlerosLiquid.toJSON().abi)
  const web3PnkToken = new web3.eth.Contract(PnkToken.toJSON().abi)
  const web3Recoverer = new web3.eth.Contract(Recoverer.toJSON().abi)
  let governor

  // Build transactions
  const transferRightsIntermediateData = web3PnkToken.methods["changeController(address)"](
    Recoverer.address
  ).encodeABI()

  const txs = {
    transferRights: {
      target: KlerosLiquid.address,
      value: 0,
      data: web3KlerosLiquid.methods["executeGovernorProposal(address,uint256,bytes)"](
        PnkToken.address,
        0,
        transferRightsIntermediateData
      ).encodeABI(),
      hash: undefined
    },
    recovery: {
      target: Recoverer.address,
      value: 0,
      data: web3Recoverer.methods["recover()"]().encodeABI(),
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

  if (BigInt(txs.transferRights.hash) < BigInt(txs.recovery.hash)) {
    deployer
      .then(async () => (governor = await Governor.deployed()))
      .then(() =>
        governor.submitList(
          [txs.transferRights.target, txs.recovery.target],
          [txs.transferRights.value, txs.recovery.value],
          txs.transferRights.data + txs.recovery.data.slice(2),
          [txs.transferRights.data.length / 2 - 1, txs.recovery.data.length / 2 - 1],
          "Recover BPool's funds"
        )
      )
      .then(logTx)
      .then(() => governor.executeTransactionList(0, 0, 2))
      .then(logTx)
  } else {
    deployer
      .then(async () => (governor = await Governor.deployed()))
      .then(() =>
        governor.submitList(
          [txs.recovery.target, txs.transferRights.target],
          [txs.recovery.value, txs.transferRights.value],
          txs.recovery.data + txs.transferRights.data.slice(2),
          [txs.recovery.data.length / 2 - 1, txs.transferRights.data.length / 2 - 1],
          "Recover BPool's funds"
        )
      )
      .then(logTx)
      .then(() => governor.executeTransactionList(0, 1, 1))
      .then(logTx)
      .then(() => governor.executeTransactionList(0, 0, 1))
      .then(logTx)
  }
}
