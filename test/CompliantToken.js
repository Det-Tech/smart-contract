import assertRevert from './helpers/assertRevert'
import mintableTokenTests from './token/MintableToken';
import burnableTokenTests from './token/BurnableToken';
import standardTokenTests from './token/StandardToken';
import basicTokenTests from './token/BasicToken';
const Registry = artifacts.require('Registry')

function compliantTokenTests([owner, oneHundred, anotherAccount], transfersToZeroBecomeBurns) {
    describe('--CompliantToken Tests--', function () {
        describe('minting', function () {
            describe('when user is on mint whitelist', function () {
                beforeEach(async function () {
                    await this.registry.setAttribute(anotherAccount, "hasPassedKYC/AML", 1, { from: owner })
                })

                mintableTokenTests([owner, oneHundred, anotherAccount])
            })

            it('rejects mint when user is not on mint whitelist', async function () {
                await assertRevert(this.token.mint(anotherAccount, 100, { from: owner }))
            })

            it('rejects mint when user is blacklisted', async function () {
                await this.registry.setAttribute(anotherAccount, "hasPassedKYC/AML", 1, { from: owner })
                await this.registry.setAttribute(anotherAccount, "isBlacklisted", 1, { from: owner })
                await assertRevert(this.token.mint(anotherAccount, 100, { from: owner }))
            })
        })

        describe('burning', function () {
            describe('when user is on burn whitelist', function () {
                beforeEach(async function () {
                    await this.registry.setAttribute(oneHundred, "canBurn", 1, { from: owner })
                })

                burnableTokenTests([owner, oneHundred, anotherAccount], transfersToZeroBecomeBurns)

                it('rejects burn when user is on blacklist', async function () {
                    await this.registry.setAttribute(oneHundred, "isBlacklisted", 1, { from: owner })
                    await assertRevert(this.token.burn(20, { from: oneHundred }))
                })
            })

            it('rejects burn when user is not on burn whitelist', async function () {
                await assertRevert(this.token.burn(20, { from: oneHundred }))
            })
        })

        if (transfersToZeroBecomeBurns) {
            describe('transfers to 0x0 become burns', function () {
                const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
                describe('burning', function () {
                    describe('when user is on burn whitelist', function () {
                        beforeEach(async function () {
                            await this.registry.setAttribute(oneHundred, "canBurn", 1, { from: owner })
                        })

                        burnableTokenTests([owner, oneHundred, anotherAccount], transfersToZeroBecomeBurns)

                        it('rejects burn when user is on blacklist', async function () {
                            await this.registry.setAttribute(oneHundred, "isBlacklisted", 1, { from: owner })
                            await assertRevert(this.token.transfer(ZERO_ADDRESS, 20, { from: oneHundred }))
                        })
                    })

                    it('rejects burn when user is not on burn whitelist', async function () {
                        await assertRevert(this.token.transfer(ZERO_ADDRESS, 20, { from: oneHundred }))
                    })
                })
            })
        }

        describe('transferring', function () {
            describe('when user is not on blacklist', function () {
                basicTokenTests([owner, oneHundred, anotherAccount], transfersToZeroBecomeBurns)
                standardTokenTests([owner, oneHundred, anotherAccount])
            })

            describe('when user is on blacklist', function () {
                it('rejects transfer from blacklisted account', async function () {
                    await this.registry.setAttribute(oneHundred, "isBlacklisted", 1, { from: owner })
                    await assertRevert(this.token.transfer(anotherAccount, 100, { from: oneHundred }))
                })

                it('rejects transfer to blacklisted account', async function () {
                    await this.registry.setAttribute(anotherAccount, "isBlacklisted", 1, { from: owner })
                    await assertRevert(this.token.transfer(anotherAccount, 100, { from: oneHundred }))
                })

                it('rejects transferFrom to blacklisted account', async function () {
                    await this.registry.setAttribute(oneHundred, "isBlacklisted", 1, { from: owner })
                    await this.token.approve(anotherAccount, 100, { from: oneHundred })
                    await assertRevert(this.token.transferFrom(oneHundred, owner, 100, { from: anotherAccount }))
                })

                it('rejects transferFrom by blacklisted spender', async function () {
                    await this.registry.setAttribute(anotherAccount, "isBlacklisted", 1, { from: owner })
                    await this.token.approve(anotherAccount, 100, { from: oneHundred })
                    await assertRevert(this.token.transferFrom(oneHundred, owner, 100, { from: anotherAccount }))
                })
            })

            describe('when user is a restricted exchange', function () {
                describe('transferFrom', function () {
                    const to = owner
                    const from = oneHundred
                    const spender = anotherAccount

                    const checkPermutation = function(a, b, c) {
                        describe('another permutation', function () {
                            beforeEach(async function () {
                                await this.token.approve(spender, 100, { from: from })
                                await this.registry.setAttribute(a, "isRestrictedExchange", 1, { from: owner })
                            })

                            it('rejects if one is not KYC/AMLed', async function () {
                                await this.registry.setAttribute(b, "hasPassedKYC/AML", 1, { from: owner })
                                await assertRevert(this.token.transferFrom(from, to, 100, { from: spender }))
                            })

                            it('rejects if another is not KYC/AMLed', async function () {
                                await this.registry.setAttribute(c, "hasPassedKYC/AML", 1, { from: owner })
                                await assertRevert(this.token.transferFrom(from, to, 100, { from: spender }))
                            })

                            it('allows if all are KYC/AMLed', async function () {
                                await this.registry.setAttribute(b, "hasPassedKYC/AML", 1, { from: owner })
                                await this.registry.setAttribute(c, "hasPassedKYC/AML", 1, { from: owner })
                                await this.token.transferFrom(from, to, 100, { from: spender })
                            })
                        })
                    }

                    checkPermutation(to, from, spender)
                    checkPermutation(spender, to, from)
                    checkPermutation(from, spender, to)
                })

                describe('transfer', function () {
                    const to = anotherAccount
                    const from = oneHundred

                    const checkPermutation = function (a, b) {
                        describe('another permutation', function () {
                            beforeEach(async function () {
                                await this.registry.setAttribute(a, "isRestrictedExchange", 1, { from: owner })
                            })

                            it('rejects if other is not KYC/AMLed', async function () {
                                await assertRevert(this.token.transfer(to, 100, { from: from }))
                            })

                            it('allows if other is KYC/AMLed', async function () {
                                await this.registry.setAttribute(b, "hasPassedKYC/AML", 1, { from: owner })
                                await this.token.transfer(to, 100, { from: from })
                            })
                        })
                    }

                    checkPermutation(to, from)
                    checkPermutation(from, to)
                })
            })
        })

        describe('wipe account', function () {
            beforeEach(async function () {
                await this.registry.setAttribute(oneHundred, "isBlacklisted", 1, { from: owner })
            })

            it('will not wipe non-blacklisted account', async function () {
                await this.registry.setAttribute(oneHundred, "isBlacklisted", 0, { from: owner })
                await assertRevert(this.token.wipeBlacklistedAccount(oneHundred, { from: owner }))
            })

            it('sets balance to 0', async function () {
                await this.token.wipeBlacklistedAccount(oneHundred, { from: owner })
                const balance = await this.token.balanceOf(oneHundred)
                assert.equal(balance, 0)
            })

            it('emits an event', async function () {
                const { logs } = await this.token.wipeBlacklistedAccount(oneHundred, { from: owner })

                assert.equal(logs.length, 1)
                assert.equal(logs[0].event, 'WipeBlacklistedAccount')
                assert.equal(logs[0].args.account, oneHundred)
                assert.equal(logs[0].args.balance, 100)
            })

            it('cannot be called by non-owner', async function () {
                await assertRevert(this.token.wipeBlacklistedAccount(oneHundred, { from: anotherAccount }))
            })
        })
    })

}

export default compliantTokenTests