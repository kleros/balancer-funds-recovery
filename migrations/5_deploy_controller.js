const Governor = artifacts.require("xMockGovernor")
const KlerosLiquid = artifacts.require("xKlerosLiquid")
const PnkToken = artifacts.require("xMiniMeToken")
const SortitionSumTreeFactory = artifacts.require("xSortitionSumTreeFactory")
// Fix contract name for linking, may be a truffle bug
//   see https://github.com/trufflesuite/truffle/blob/cf495db2b261751df8bdaba450701c6032901337/packages/deployer/src/linker.js#L44
//   see https://github.com/trufflesuite/truffle/blob/c7b8edf5e949aa2b9d433d0f60730a1b86f55fb4/packages/contract/lib/utils/index.js#L124
SortitionSumTreeFactory.contract_name = "KlerosLiquid.sol:SortitionSumTreeFac"

const settings = {
  governor: Governor.address,
  pinakion: PnkToken.address,
  RNGenerator: "0x0123456789abcDEF0123456789abCDef01234567", // unused
  minStakingTime: 3600, // unused
  maxDrawingTime: 7200, // unused
  hiddenVotes: false, // unused
  minStake: "1000000000000000000000", // 1000, unused
  alpha: 2500, // unused
  feeForJuror: "1000000000000000000", // 1, unused
  jurorsForCourtJump: 255, // unused
  timesPerPeriod: [367200, 626400, 604800, 604800], // unused
  sortitionSumTreeK: 6 // unused
}

module.exports = function (deployer) {
  deployer.deploy(SortitionSumTreeFactory)
  deployer.link(SortitionSumTreeFactory, KlerosLiquid)
  deployer.deploy(
    KlerosLiquid,
    settings.governor,
    settings.pinakion,
    settings.RNGenerator,
    settings.minStakingTime,
    settings.maxDrawingTime,
    settings.hiddenVotes,
    settings.minStake,
    settings.alpha,
    settings.feeForJuror,
    settings.jurorsForCourtJump,
    settings.timesPerPeriod,
    settings.sortitionSumTreeK
  )
}
