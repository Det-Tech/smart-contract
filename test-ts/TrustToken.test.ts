import { constants, providers, Wallet } from 'ethers'
import { solidity } from 'ethereum-waffle'
import { expect, use } from 'chai'
import { beforeEachWithFixture } from './utils/beforeEachWithFixture'
import { setupDeploy } from '../scripts/utils'
import { TrustTokenFactory } from '../build/types/TrustTokenFactory'
import { TrustToken } from '../build/types/TrustToken'
import { RegistryFactory } from '../build/types/RegistryFactory'
import { timeTravel, timeTravelTo } from './utils/timeTravel'
import { parseTT } from './utils/parseTT'

use(solidity)

describe('TrustToken', () => {
  let owner: Wallet, timeLockRegistry: Wallet, saftHolder: Wallet
  let trustToken: TrustToken
  let provider: providers.JsonRpcProvider

  beforeEachWithFixture(async (_provider, wallets) => {
    ([owner, timeLockRegistry, saftHolder] = wallets)
    provider = _provider
    const deployContract = setupDeploy(owner)
    trustToken = await deployContract(TrustTokenFactory)
    const registry = await deployContract(RegistryFactory)
    await trustToken.initialize(registry.address)
    await trustToken.mint(timeLockRegistry.address, parseTT(1000))
    await trustToken.setTimeLockRegistry(timeLockRegistry.address)
  })

  it('only owner can set timeLockRegistry address', async () => {
    await expect(trustToken.connect(timeLockRegistry).setTimeLockRegistry(timeLockRegistry.address)).to.be.revertedWith('only owner')
  })

  describe('TimeLock', () => {
    const DAY = 24 * 3600
    const TOTAL_LOCK_TIME = DAY * (120 + 7 * 90)
    const initializationTimestamp = 1595609911

    beforeEach(async () => {
      await timeTravelTo(provider, initializationTimestamp)
      await trustToken.connect(timeLockRegistry).registerLockup(saftHolder.address, parseTT(100))
    })

    it('correctly setups epoch start', async () => {
      expect(await trustToken.lockStart()).to.equal(initializationTimestamp)
      expect(await trustToken.epochsPassed()).to.equal(0)
      expect(await trustToken.latestEpoch(), 'latest epoch').to.equal(initializationTimestamp)
      expect(await trustToken.nextEpoch(), 'next epoch').to.equal(initializationTimestamp + DAY * 120)
      expect(await trustToken.finalEpoch(), 'final epoch').to.equal(initializationTimestamp + TOTAL_LOCK_TIME)
    })

    ;[
      [120, 1],
      [150, 1],
      [209, 1],
      [210, 2],
      [299, 2],
      [300, 3],
      [389, 3],
      [390, 4],
      [479, 4],
      [480, 5],
      [569, 5],
      [570, 6],
      [659, 6],
      [660, 7],
      [749, 7],
    ].forEach(([days, expectedEpochsPassed]) => {
      it(`counts ${expectedEpochsPassed} epochs as passed after ${days} days`, async () => {
        await timeTravel(provider, DAY * days)
        const expectedLatestEpoch = initializationTimestamp + (120 + (expectedEpochsPassed - 1) * 90) * DAY

        expect(await trustToken.epochsPassed()).to.equal(expectedEpochsPassed)
        expect(await trustToken.latestEpoch()).to.equal(expectedLatestEpoch)
        expect(await trustToken.nextEpoch()).to.equal(expectedLatestEpoch + 90 * DAY)
      })
    })

    it('counts 8 epochs as passed after 750 days', async () => {
      await timeTravel(provider, DAY * 750)
      const expectedLatestEpoch = initializationTimestamp + (120 + (8 - 1) * 90) * DAY

      expect(await trustToken.epochsPassed()).to.equal(8)
      expect(await trustToken.latestEpoch()).to.equal(expectedLatestEpoch)
      expect(await trustToken.nextEpoch()).to.equal(constants.MaxUint256)
    })

    it('counts 8 epochs as passed after 7501 days', async () => {
      await timeTravel(provider, DAY * 7501)
      const expectedLatestEpoch = initializationTimestamp + (120 + (8 - 1) * 90) * DAY

      expect(await trustToken.epochsPassed()).to.equal(8)
      expect(await trustToken.latestEpoch()).to.equal(expectedLatestEpoch)
      expect(await trustToken.nextEpoch()).to.equal(constants.MaxUint256)
    })

    it('does not unlock funds until epoch passes', async () => {
      await timeTravel(provider, DAY * 119)

      expect(await trustToken.epochsPassed()).to.equal(0)
      expect(await trustToken.latestEpoch()).to.equal(initializationTimestamp)
      expect(await trustToken.nextEpoch()).to.equal(initializationTimestamp + DAY * 120)
      expect(await trustToken.balanceOf(saftHolder.address)).to.equal(parseTT(100))
      expect(await trustToken.lockedBalance(saftHolder.address)).to.equal(parseTT(100))
      expect(await trustToken.unlockedBalance(saftHolder.address)).to.equal(0)
    })

    it('unlocks 1/8 of locked funds after epoch passes', async () => {
      await timeTravel(provider, DAY * 120)

      expect(await trustToken.epochsPassed()).to.equal(1)
      expect(await trustToken.unlockedBalance(saftHolder.address)).to.equal(parseTT(100).div(8))
      expect(await trustToken.lockedBalance(saftHolder.address)).to.equal(parseTT(100).div(8).mul(7))
      expect(await trustToken.balanceOf(saftHolder.address)).to.equal(parseTT(100))

      await timeTravel(provider, DAY * 90)

      expect(await trustToken.epochsPassed()).to.equal(2)
      expect(await trustToken.unlockedBalance(saftHolder.address)).to.equal(parseTT(100).div(8).mul(2))
      expect(await trustToken.lockedBalance(saftHolder.address)).to.equal(parseTT(100).div(8).mul(6))
      expect(await trustToken.balanceOf(saftHolder.address)).to.equal(parseTT(100))
    })

    it('unlocks all funds after total lock time passes', async () => {
      await timeTravel(provider, TOTAL_LOCK_TIME)

      expect(await trustToken.unlockedBalance(saftHolder.address)).to.equal(parseTT(100))
      expect(await trustToken.lockedBalance(saftHolder.address)).to.equal(0)
      expect(await trustToken.balanceOf(saftHolder.address)).to.equal(parseTT(100))

      await timeTravel(provider, TOTAL_LOCK_TIME * 10)

      expect(await trustToken.unlockedBalance(saftHolder.address)).to.equal(parseTT(100))
      expect(await trustToken.lockedBalance(saftHolder.address)).to.equal(0)
      expect(await trustToken.balanceOf(saftHolder.address)).to.equal(parseTT(100))
      expect(await trustToken.nextEpoch()).to.equal(constants.MaxUint256)
    })

    it('is impossible to give lock funds twice to a person', async () => {
      await expect(trustToken.connect(timeLockRegistry).registerLockup(saftHolder.address, parseTT(100))).to.be.revertedWith('distribution already set')
    })

    it('only timeLockRegistry can register lockups', async () => {
      await expect(trustToken.connect(owner).registerLockup(saftHolder.address, parseTT(100))).to.be.revertedWith('only TimeLockRegistry')
    })

    context('Transfers', () => {
      it('cannot transfer locked funds', async () => {
        await expect(trustToken.connect(saftHolder).transfer(owner.address, 1)).to.be.revertedWith('attempting to transfer locked funds')
      })

      it('can transfer unlocked funds', async () => {
        await timeTravel(provider, DAY * 120)

        await trustToken.connect(saftHolder).transfer(owner.address, parseTT(100).div(8))

        expect(await trustToken.unlockedBalance(saftHolder.address)).to.equal(0)
        expect(await trustToken.lockedBalance(saftHolder.address)).to.equal(parseTT(100).div(8).mul(7))
        expect(await trustToken.balanceOf(saftHolder.address)).to.equal(parseTT(100).div(8).mul(7))
      })

      it('cannot transfer more than unlocked funds', async () => {
        await timeTravel(provider, DAY * 120)

        await expect(trustToken.connect(saftHolder).transfer(owner.address, parseTT(100).div(8).add(1))).to.be.revertedWith('attempting to transfer locked funds')
      })

      it('if account has received tokens in normal way, they are transferable', async () => {
        await trustToken.connect(timeLockRegistry).transfer(saftHolder.address, parseTT(10))

        expect(await trustToken.balanceOf(saftHolder.address)).to.equal(parseTT(110))
        expect(await trustToken.lockedBalance(saftHolder.address)).to.equal(parseTT(100))

        await trustToken.connect(saftHolder).transfer(owner.address, parseTT(10))

        expect(await trustToken.balanceOf(saftHolder.address)).to.equal(parseTT(100))
        expect(await trustToken.balanceOf(owner.address)).to.equal(parseTT(10))
      })

      it('if account has received tokens in normal way, they are transferable after some epochs has passed', async () => {
        await timeTravel(provider, DAY * 220)
        await trustToken.connect(timeLockRegistry).transfer(saftHolder.address, parseTT(10))

        await trustToken.connect(saftHolder).transfer(owner.address, parseTT(35))

        expect(await trustToken.balanceOf(saftHolder.address)).to.equal(parseTT(75))
        expect(await trustToken.balanceOf(owner.address)).to.equal(parseTT(35))

        await expect(trustToken.connect(saftHolder).transfer(owner.address, 1)).to.be.revertedWith('attempting to transfer locked funds')
      })

      it('cannot transfer more than balance', async () => {
        await expect(trustToken.connect(saftHolder).transfer(owner.address, parseTT(100).add(1))).to.be.revertedWith('insufficient balance')
      })

      describe('transferFrom', () => {
        beforeEach(async () => {
          await trustToken.connect(saftHolder).approve(timeLockRegistry.address, parseTT(100))
        })

        it('cannot transfer locked funds', async () => {
          await expect(trustToken.connect(timeLockRegistry).transferFrom(saftHolder.address, owner.address, 1)).to.be.revertedWith('attempting to transfer locked funds')
        })

        it('can transfer unlocked funds', async () => {
          await timeTravel(provider, DAY * 120)
          await trustToken.connect(timeLockRegistry).transferFrom(saftHolder.address, owner.address, parseTT(100).div(8))

          expect(await trustToken.unlockedBalance(saftHolder.address)).to.equal(0)
          expect(await trustToken.lockedBalance(saftHolder.address)).to.equal(parseTT(100).div(8).mul(7))
          expect(await trustToken.balanceOf(saftHolder.address)).to.equal(parseTT(100).div(8).mul(7))
        })

        it('cannot transfer more than unlocked funds', async () => {
          await timeTravel(provider, DAY * 120)

          await expect(trustToken.connect(timeLockRegistry).transferFrom(saftHolder.address, owner.address, parseTT(100).div(8).add(1))).to.be.revertedWith('attempting to transfer locked funds')
        })

        it('if account has received tokens in normal way, they are transferable', async () => {
          await trustToken.connect(timeLockRegistry).transfer(saftHolder.address, parseTT(10))

          expect(await trustToken.balanceOf(saftHolder.address)).to.equal(parseTT(110))
          expect(await trustToken.lockedBalance(saftHolder.address)).to.equal(parseTT(100))

          await trustToken.connect(timeLockRegistry).transferFrom(saftHolder.address, owner.address, parseTT(10))

          expect(await trustToken.balanceOf(saftHolder.address)).to.equal(parseTT(100))
          expect(await trustToken.balanceOf(owner.address)).to.equal(parseTT(10))
        })

        it('if account has received tokens in normal way, they are transferable after some epochs has passed', async () => {
          await timeTravel(provider, DAY * 220)
          await trustToken.connect(timeLockRegistry).transfer(saftHolder.address, parseTT(10))

          await trustToken.connect(timeLockRegistry).transferFrom(saftHolder.address, owner.address, parseTT(35))

          expect(await trustToken.balanceOf(saftHolder.address)).to.equal(parseTT(75))
          expect(await trustToken.balanceOf(owner.address)).to.equal(parseTT(35))

          await expect(trustToken.connect(timeLockRegistry).transferFrom(saftHolder.address, owner.address, 1)).to.be.revertedWith('attempting to transfer locked funds')
        })

        it('cannot transfer more than balance', async () => {
          await expect(trustToken.connect(timeLockRegistry).transferFrom(saftHolder.address, owner.address, parseTT(100).add(1))).to.be.revertedWith('insufficient balance')
        })
      })
    })
  })
})
