const WethToken = artifacts.require("xWETH9")
const PnkToken = artifacts.require("xMiniMeToken")
const Governor = artifacts.require("xMockGovernor")
const KlerosLiquid = artifacts.require("xKlerosLiquid")
const BPool = artifacts.require("xBPool")
const Recoverer = artifacts.require("BalancerPoolRecoverer")

module.exports = function (deployer, network, accounts) {
  const addressOf = require("./utils/addressOf")(accounts)
  deployer.deploy(
    Recoverer,
    Governor.address,
    PnkToken.address,
    WethToken.address,
    BPool.address,
    KlerosLiquid.address,
    addressOf.beneficiary,
    { from: addressOf.attacker }
  )
}
