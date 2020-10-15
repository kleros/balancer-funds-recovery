const settings = {
  amount: "1578995576647687079"
}

const BPool = artifacts.require("xBPool")
const PnkToken = artifacts.require("xMiniMeToken")
const WethToken = artifacts.require("xWETH9")

module.exports = function (deployer, network, accounts) {
  const addressOf = require("./utils/addressOf")(accounts)
  const logTx = require("./utils/logTx")([BPool, PnkToken, WethToken]).bind({ web3: web3 })

  // Instances
  let pool
  let wethToken
  let pnkToken

  // Computations
  let wethIn
  let pnkIn

  deployer
    .then(async () => {
      // Instances
      pool = await BPool.deployed()
      wethToken = await WethToken.deployed()
      pnkToken = await PnkToken.deployed()

      // Computations
      const BONE = 1000000000000000000n

      const bptTotalSupply = await pool.totalSupply()
      const ratio =
        (BigInt(settings.amount) * BONE + BigInt(bptTotalSupply) / 2n) / BigInt(bptTotalSupply)

      const wethBalance = await pool.getBalance(WethToken.address)
      const pnkBalance = await pool.getBalance(PnkToken.address)

      wethIn = ((ratio * BigInt(wethBalance) + BONE / 2n) / BONE).toString()
      pnkIn = ((ratio * BigInt(pnkBalance) + BONE / 2n) / BONE).toString()
    })
    // Migration
    .then(() => wethToken.deposit({ from: addressOf.other, value: wethIn })) // Mint WETH
    .then(logTx)
    .then(() => wethToken.approve(BPool.address, wethIn, { from: addressOf.other })) // Approve WETH
    .then(logTx)
    .then(() => pnkToken.generateTokens(addressOf.other, pnkIn, { from: addressOf.deployer })) // Mint PNK
    .then(logTx)
    .then(() => pnkToken.approve(BPool.address, pnkIn, { from: addressOf.other })) // Approve PNK
    .then(logTx)
    .then(() => pool.joinPool(settings.amount, [wethIn, pnkIn], { from: addressOf.other }))
    .then(logTx)
}
