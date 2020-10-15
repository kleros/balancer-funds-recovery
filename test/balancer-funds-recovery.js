/* global assert, before, contract, it */
const settings = {
  targetWethBalance: "1497869045760000000000", // 1,497.869 WETH
  targetPnkBalance: "7481018020279440000000000" // 7,481,018.020 PNK
}

const BPool = artifacts.require("xBPool")
const KlerosLiquid = artifacts.require("xKlerosLiquid")
const PnkToken = artifacts.require("xMiniMeToken")
const WethToken = artifacts.require("xWETH9")
const Recoverer = artifacts.require("BalancerPoolRecoverer")

contract("BalancerPoolRecoverer", (accounts) => {
  const addressOf = require("../migrations/utils/addressOf")(accounts)

  let pool
  let wethToken
  let pnkToken
  let recoverer

  before("Show balances", async () => {
    pool = await BPool.deployed()
    wethToken = await WethToken.deployed()
    pnkToken = await PnkToken.deployed()
    recoverer = await Recoverer.deployed()

    const accountList = [
      { address: addressOf.deployer, name: "Deployer" },
      { address: addressOf.other, name: "Other" },
      { address: addressOf.beneficiary, name: "Beneficiary" },
      { address: addressOf.attacker, name: "Attacker" },
      { address: BPool.address, name: "BPool" },
      { address: Recoverer.address, name: "Recoverer" }
    ]

    const BONE = Number(10n ** 18n)

    let balances = {}
    for (let account of accountList) {
      balances[account.name] = {
        ETH: Number((await wethToken.balanceOf(account.address)).toString()) / BONE,
        PNK: Number((await pnkToken.balanceOf(account.address)).toString()) / BONE,
        BPT: Number((await pool.balanceOf(account.address)).toString()) / BONE
      }
    }

    console.log()
    console.dir({ Balances: balances })
    console.log()
  })

  it("[Setup] 98 BPT should be locked", async () => {
    const balance = await pool.balanceOf(BPool.address)
    assert.equal(balance.toString(), "98000000000000000000")
  })

  it("BPool's PNK balance should be 0", async () => {
    const balance = await pnkToken.balanceOf(BPool.address)
    assert.equal(balance.toNumber(), 0)
  })

  it("Next expected gain should be below minimum gain", async () => {
    const expected = Number(BigInt(await wethToken.balanceOf(BPool.address)) / 3n)
    const gasPerIteration = await recoverer.gasPerIteration()
    const gasPrice = await Recoverer.defaults().gasPrice
    const minimum = Number(BigInt(gasPrice) * BigInt(gasPerIteration))

    assert.ok(expected < minimum)
  })

  it("Beneficiary should have all the PNK", async () => {
    const balance = await pnkToken.balanceOf(addressOf.beneficiary)
    assert.equal(balance.toString(), settings.targetPnkBalance)
  })

  it("Beneficiary and pool should share all the WETH", async () => {
    const beneficiaryBalance = await wethToken.balanceOf(addressOf.beneficiary)
    const poolBalance = await wethToken.balanceOf(BPool.address)
    const sum = beneficiaryBalance.add(poolBalance)
    assert.equal(sum.toString(), settings.targetWethBalance)
  })

  it("PNK's controller should be reset", async () => {
    const controller = await pnkToken.controller()
    assert.equal(controller, KlerosLiquid.address)
  })
})
