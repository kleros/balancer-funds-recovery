const settings = {
  toLock: "98000000000000000000"
}

const BPool = artifacts.require("xBPool")

module.exports = function (deployer) {
  const logTx = require("./utils/logTx")([BPool]).bind({ web3: web3 })

  let pool

  deployer
    .then(async () => (pool = await BPool.deployed()))
    .then(() => pool.transfer(BPool.address, settings.toLock))
    .then(logTx)
}
