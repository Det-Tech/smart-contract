import { expect, use } from 'chai'
import { providers, Wallet } from 'ethers'
import { solidity } from 'ethereum-waffle'
import { MaxUint256 } from '@ethersproject/constants'

import { setupDeploy } from 'scripts/utils'

import { beforeEachWithFixture, DAY, expectScaledCloseTo, parseEth, parseTRU, timeTravel, timeTravelTo } from 'utils'

import {
  LinearTrueDistributor, LinearTrueDistributorFactory,
  MockTrueCurrency,
  MockTrueCurrencyFactory,
  StkTruToken,
  StkTruTokenFactory,
  TrustToken,
  TrustTokenFactory,
} from 'contracts'

use(solidity)

describe('StkTruToken', () => {
  let owner: Wallet
  let staker: Wallet
  let liquidator: Wallet
  let tru: TrustToken
  let stkToken: StkTruToken
  let tfusd: MockTrueCurrency
  let distributor: LinearTrueDistributor
  let provider: providers.JsonRpcProvider

  const amount = parseTRU(100)
  const stakeCooldown = DAY * 14

  beforeEachWithFixture(async (wallets, _provider) => {
    ([owner, staker, liquidator] = wallets)
    provider = _provider
    const deployContract = setupDeploy(owner)
    tru = await deployContract(TrustTokenFactory)
    await tru.initialize()
    tfusd = await deployContract(MockTrueCurrencyFactory)
    distributor = await deployContract(LinearTrueDistributorFactory)

    stkToken = await deployContract(StkTruTokenFactory)
    await stkToken.initialize(tru.address, tfusd.address, distributor.address, liquidator.address)

    await tru.mint(owner.address, amount)
    await tru.approve(stkToken.address, amount)

    await tru.mint(staker.address, amount.div(2))
    await tru.connect(staker).approve(stkToken.address, amount.div(2))
  })

  describe('setCooldownTime', () => {
    it('changes value', async () => {
      await stkToken.setCooldownTime(100)
      expect(await stkToken.cooldownTime()).to.equal(100)
    })

    it('only owner', async () => {
      await expect(stkToken.connect(staker).setCooldownTime(100)).to.be.revertedWith('only owner')
    })

    it('cannot be infinite', async () => {
      await expect(stkToken.setCooldownTime(MaxUint256)).to.be.revertedWith('StkTruToken: Cooldown too large')
    })
  })

  describe('setUnstakePeriodDuration', () => {
    it('changes value', async () => {
      await stkToken.setUnstakePeriodDuration(100)
      expect(await stkToken.unstakePeriodDuration()).to.equal(100)
    })

    it('only owner', async () => {
      await expect(stkToken.connect(staker).setUnstakePeriodDuration(100)).to.be.revertedWith('only owner')
    })

    it('cannot be infinite', async () => {
      await expect(stkToken.setUnstakePeriodDuration(MaxUint256)).to.be.revertedWith('StkTruToken: Unstake period too large')
    })

    it('cannot be 0', async () => {
      await expect(stkToken.setUnstakePeriodDuration(0)).to.be.revertedWith('StkTruToken: Unstake period cannot be 0')
    })
  })

  describe('Staking-Unstaking', () => {
    it('stake emits event', async () => {
      await expect(stkToken.stake(amount)).to.emit(stkToken, 'Stake').withArgs(owner.address, amount)
    })

    it('unstake emits event', async () => {
      await stkToken.stake(amount)
      await stkToken.cooldown()
      await timeTravel(provider, stakeCooldown)
      await expect(stkToken.unstake(amount)).to.emit(stkToken, 'Unstake').withArgs(owner.address, amount)
    })

    it('tokens are burnt on unstake', async () => {
      await stkToken.stake(amount)
      await stkToken.cooldown()
      await timeTravel(provider, stakeCooldown)
      await stkToken.unstake(amount)
      expect(await stkToken.totalSupply()).to.equal(0)
    })

    it('changes stake supply', async () => {
      await stkToken.stake(amount)
      expect(await stkToken.stakeSupply()).to.equal(amount)
      await stkToken.cooldown()
      await timeTravel(provider, stakeCooldown)
      await stkToken.unstake(amount)
      expect(await stkToken.stakeSupply()).to.equal(0)
    })

    it('single user stakes, unstakes, gets same amount of TRU', async () => {
      await stkToken.stake(amount)
      await stkToken.cooldown()
      await timeTravel(provider, stakeCooldown)
      await stkToken.unstake(amount)
      expect(await tru.balanceOf(owner.address)).to.equal(amount)
    })

    it('multiple users get proportional amounts of TRU', async () => {
      await stkToken.stake(amount)
      await stkToken.connect(staker).stake(amount.div(2))

      expect(await stkToken.balanceOf(owner.address)).to.equal(amount)
      expect(await stkToken.balanceOf(staker.address)).to.equal(amount.div(2))

      await stkToken.connect(staker).cooldown()
      await stkToken.cooldown()

      await timeTravel(provider, stakeCooldown)
      await stkToken.unstake(amount)
      await stkToken.connect(staker).unstake(amount.div(2))
      expect(await tru.balanceOf(owner.address)).to.equal(amount)
      expect(await tru.balanceOf(staker.address)).to.equal(amount.div(2))
    })
  })

  describe('Withdraw', () => {
    const liquidationAmount = parseTRU(1)

    it('can be called only by the liquidator', async () => {
      await expect(stkToken.withdraw(1)).to.be.revertedWith('StkTruToken: Can be called only by the liquidator')
    })

    it('transfers amount to liquidator', async () => {
      await stkToken.stake(amount)
      await stkToken.connect(liquidator).withdraw(liquidationAmount)
      expect(await tru.balanceOf(liquidator.address)).to.equal(liquidationAmount)
    })

    it('reduces stake supply', async () => {
      await stkToken.stake(amount)
      await stkToken.connect(liquidator).withdraw(liquidationAmount)
      expect(await stkToken.stakeSupply()).to.equal(amount.sub(liquidationAmount))
    })

    it('emits event', async () => {
      await stkToken.stake(amount)
      await expect(stkToken.connect(liquidator).withdraw(liquidationAmount)).to.emit(stkToken, 'Withdraw')
        .withArgs(liquidationAmount)
    })

    it('staking post withdraw works correctly', async () => {
      await stkToken.stake(amount)
      await stkToken.connect(liquidator).withdraw(liquidationAmount)
      await stkToken.connect(staker).stake(amount.div(2))
      expect(await stkToken.balanceOf(staker.address)).to.equal(amount.div(2).mul(100).div(99))

      await stkToken.cooldown()
      await stkToken.connect(staker).cooldown()
      await timeTravel(provider, stakeCooldown)

      await stkToken.connect(staker).unstake(await stkToken.balanceOf(staker.address))
      await stkToken.unstake(amount)

      expect(await tru.balanceOf(owner.address)).to.equal(parseTRU(99).add(1))
      expect(await tru.balanceOf(staker.address)).to.equal(amount.div(2).sub(1))
    })
  })

  describe('Claim', () => {
    const distributionStart = 1700000000

    beforeEach(async () => {
      await distributor.initialize(distributionStart, 10 * DAY, parseTRU(100), tru.address)
      await tru.mint(distributor.address, parseTRU(100))
      await distributor.setFarm(stkToken.address)
      await timeTravelTo(provider, distributionStart)
    })

    it('complex scenario', async () => {
      await stkToken.stake(amount)
      await timeTravel(provider, DAY)

      await tfusd.mint(stkToken.address, parseEth(1))

      expectScaledCloseTo(await stkToken.claimable(owner.address, tru.address), parseTRU(10))
      expect(await stkToken.claimable(owner.address, tfusd.address)).to.equal(parseEth(1))

      await stkToken.connect(staker).stake(amount.div(2))
      await timeTravel(provider, DAY)

      expectScaledCloseTo(await stkToken.claimable(owner.address, tru.address), parseTRU(16.66666))
      expectScaledCloseTo(await stkToken.claimable(staker.address, tru.address), parseTRU(3.333333))

      await tru.mint(stkToken.address, parseTRU(30))

      expectScaledCloseTo(await stkToken.claimable(owner.address, tru.address), parseTRU(36.66666))
      expectScaledCloseTo(await stkToken.claimable(staker.address, tru.address), parseTRU(13.333333))

      expect(await stkToken.claimable(owner.address, tfusd.address)).to.equal(parseEth(1))
      expect(await stkToken.claimable(staker.address, tfusd.address)).to.equal(0)

      await tfusd.mint(stkToken.address, parseEth(3))

      expect(await stkToken.claimable(owner.address, tfusd.address)).to.equal(parseEth(3))
      expect(await stkToken.claimable(staker.address, tfusd.address)).to.equal(parseEth(1))

      await stkToken.claim()
      await stkToken.connect(staker).claim()

      expectScaledCloseTo(await tru.balanceOf(owner.address), parseTRU(36.66666))
      expectScaledCloseTo(await tru.balanceOf(staker.address), parseTRU(13.333333))
      expect(await tfusd.balanceOf(owner.address)).to.equal(parseEth(3))
      expect(await tfusd.balanceOf(staker.address)).to.equal(parseEth(1))
    })
  })

  describe('Cooldown', () => {
    it('emits event', async () => {
      const tx = await stkToken.cooldown()
      const block = await provider.getBlock(tx.blockNumber)

      await expect(Promise.resolve(tx)).to.emit(stkToken, 'Cooldown')
        .withArgs(owner.address, block.timestamp + stakeCooldown)
    })

    it('cannot unstake without starting cooldown timer', async () => {
      await stkToken.stake(amount)
      await timeTravel(provider, stakeCooldown)
      await expect(stkToken.unstake(amount)).to.be.revertedWith('StkTruToken: Stake on cooldown')
    })

    it('cannot unstake on cooldown', async () => {
      await stkToken.stake(amount)
      await stkToken.cooldown()
      await timeTravel(provider, stakeCooldown - DAY)
      await expect(stkToken.unstake(amount)).to.be.revertedWith('StkTruToken: Stake on cooldown')
    })

    it('cannot unstake after unstake window has passed', async () => {
      await stkToken.stake(amount)
      await stkToken.cooldown()
      await timeTravel(provider, stakeCooldown + 2 * DAY + 1)
      await expect(stkToken.unstake(amount)).to.be.revertedWith('StkTruToken: Stake on cooldown')
    })

    it('calling cooldown twice does not restart cooldown', async () => {
      await stkToken.stake(amount)
      await stkToken.cooldown()
      const unlockTimeBefore = await stkToken.unlockTime(owner.address)
      await timeTravel(provider, DAY)
      await stkToken.cooldown()
      await expect(await stkToken.unlockTime(owner.address)).to.equal(unlockTimeBefore)
    })

    it('staking more resets cooldown', async () => {
      await stkToken.stake(amount.div(2))
      await stkToken.cooldown()
      await timeTravel(provider, DAY)
      const tx = await stkToken.stake(amount.div(2))
      const block = await provider.getBlock(tx.blockNumber)

      await expect(await stkToken.unlockTime(owner.address)).to.equal(block.timestamp + 14 * DAY)
    })

    it('staking on expired cooldown does not reset cooldown', async () => {
      await stkToken.stake(amount.div(2))
      await stkToken.cooldown()
      await timeTravel(provider, stakeCooldown + 2 * DAY + 1)

      await expect(await stkToken.unlockTime(owner.address)).to.equal(MaxUint256)
    })

    it('when unstake is off cooldown, staking does not reset cooldown', async () => {
      await stkToken.stake(amount.div(2))
      await stkToken.cooldown()
      const unlockTimeBefore = await stkToken.unlockTime(owner.address)
      await timeTravel(provider, stakeCooldown)
      await stkToken.stake(amount.div(2))
      await expect(await stkToken.unlockTime(owner.address)).to.equal(unlockTimeBefore)
    })
  })

  describe('Voting power decreases after liquidation', () => {
    let withdrawBlockNumber: number

    beforeEach(async () => {
      await stkToken.delegate(owner.address)
      await stkToken.stake(amount)
      ;({ blockNumber: withdrawBlockNumber } = await (await stkToken.connect(liquidator).withdraw(parseTRU(1))).wait())
    })

    it('getCurrentVotes has decreased', async () => {
      expect(await stkToken.getCurrentVotes(owner.address)).to.equal(parseTRU(99))
    })

    it('getCurrentVotes after delegation', async () => {
      await stkToken.delegate(staker.address)
      expect(await stkToken.getCurrentVotes(owner.address)).to.equal(0)
      expect(await stkToken.getCurrentVotes(staker.address)).to.equal(parseTRU(99))
    })

    it('getPriorVotes has decreased', async () => {
      expect(await stkToken.getPriorVotes(owner.address, withdrawBlockNumber - 1)).to.equal(parseTRU(99))
    })
  })
})
