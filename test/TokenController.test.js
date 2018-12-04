import assertRevert from './helpers/assertRevert'
import expectThrow from './helpers/expectThrow'
import assertBalance from './helpers/assertBalance'
import increaseTime, { duration } from './helpers/increaseTime'
import { throws } from 'assert'
const Registry = artifacts.require("Registry")
const TrueUSD = artifacts.require("TrueUSD")
const BalanceSheet = artifacts.require("BalanceSheet")
const AllowanceSheet = artifacts.require("AllowanceSheet")
const TokenController = artifacts.require("TokenController")
const TrueUSDMock = artifacts.require("TrueUSDMock")
const ForceEther = artifacts.require("ForceEther")
const FastPauseMints = artifacts.require("FastPauseMints")
const FastPauseTrueUSD = artifacts.require("FastPauseTrueUSD")
const GlobalPause = artifacts.require("GlobalPause")

contract('TokenController', function (accounts) {

    describe('--TokenController Tests--', function () {
        const [_, owner, oneHundred, otherAddress, mintKey, pauseKey, pauseKey2, ratifier1, ratifier2, ratifier3, redemptionAdmin] = accounts

        beforeEach(async function () {
            this.registry = await Registry.new({ from: owner })
            this.token = await TrueUSDMock.new(oneHundred, 100*10**18, { from: owner })
            this.globalPause = await GlobalPause.new({ from: owner })
            await this.token.setGlobalPause(this.globalPause.address, { from: owner })    
            this.controller = await TokenController.new({ from: owner })
            this.fastPauseMints = await FastPauseMints.new(pauseKey2, this.controller.address, { from: owner })
            await this.controller.initialize({ from: owner })
            await this.controller.setRegistry(this.registry.address, { from: owner })
            await this.controller.setTrueUSD(this.token.address, { from: owner })
            await this.controller.initializeTrueUSD(100*10**18, { from: owner })
            await this.controller.setTusdRegistry(this.registry.address, { from: owner })
            await this.controller.transferMintKey(mintKey, { from: owner })
            this.balanceSheet = await this.token.balances()
            this.allowanceSheet = await this.token.allowances()
            await this.registry.setAttribute(oneHundred, "hasPassedKYC/AML", 1, web3.fromUtf8("notes"), { from: owner })
            await this.registry.setAttribute(otherAddress, "hasPassedKYC/AML", 1, web3.fromUtf8("notes"), { from: owner })
            await this.registry.setAttribute(ratifier1, "isTUSDMintRatifier", 1, web3.fromUtf8("notes"), { from: owner })
            await this.registry.setAttribute(ratifier2, "isTUSDMintRatifier", 1, web3.fromUtf8("notes"), { from: owner })
            await this.registry.setAttribute(ratifier3, "isTUSDMintRatifier", 1, web3.fromUtf8("notes"), { from: owner })
            await this.registry.setAttribute(pauseKey, "isTUSDMintPausers", 1, web3.fromUtf8("notes"), { from: owner })
            await this.registry.setAttribute(this.fastPauseMints.address, "isTUSDMintPausers", 1, web3.fromUtf8("notes"), { from: owner })
        })

        describe('Request and Finalize Mints (owner)', function () {

            beforeEach(async function () {
                await this.controller.setMintThresholds(10*10**18,100*10**18,1000*10**18, { from: owner })
                await this.controller.setMintLimits(30*10**18,300*10**18,3000*10**18,{ from: owner })
            })

            it('non mintKey/owner cannot request mint', async function () {
                await assertRevert(this.controller.requestMint(oneHundred, 10*10**18 , { from: otherAddress }))
            })

            it('request a mint', async function () {
                const originalMintOperationCount = await this.controller.mintOperationCount()
                assert.equal(originalMintOperationCount, 0)
                await this.controller.requestMint(oneHundred, 10*10**18 , { from: owner })
                const mintOperation = await this.controller.mintOperations(0)
                assert.equal(mintOperation[0], oneHundred)
                assert.equal(Number(mintOperation[1]), 10*10**18)
                assert.equal(Number(mintOperation[3]), 0,"numberOfApprovals not 0")
                const mintOperationCount = await this.controller.mintOperationCount()
                assert.equal(mintOperationCount, 1)
            })

            it('request mint then revoke it', async function () {
                await this.controller.requestMint(oneHundred, 10*10**18 , { from: mintKey })
                const { logs } = await this.controller.revokeMint(0, {from: mintKey})
                assert.equal(logs.length, 1)
                assert.equal(logs[0].event, 'RevokeMint')
                assert.equal(logs[0].args.opIndex, 0,"wrong opIndex")
                const mintOperation = await this.controller.mintOperations(0)
                assert.equal(mintOperation[0], "0x0000000000000000000000000000000000000000","to address not 0")
                assert.equal(Number(mintOperation[1]), 0,"value not 0")
                assert.equal(Number(mintOperation[2]), 0,"requested block not 0")
                assert.equal(Number(mintOperation[3]), 0,"numberOfApprovals not 0")
            })

            it('request and finalize a mint', async function () {
                await this.controller.requestMint(oneHundred, 10*10**18 , { from: owner })
                const {logs} = await this.controller.ratifyMint(0, oneHundred, 10*10**18, {from: owner})
                assert.equal(logs[0].event,"MintRatified");
                assert.equal(Number(logs[0].args.opIndex),0);
                assert.equal(logs[0].args.ratifier,owner);
                assert.equal(logs[1].event,"FinalizeMint");
                assert.equal(Number(logs[1].args.value),10*10**18);
                assert.equal(logs[1].args.to,oneHundred);
                assert.equal(Number(logs[1].args.opIndex),0);
                assert.equal(logs[1].args.mintKey,owner);
                const totalSupply = await this.token.totalSupply()
                assert.equal(Number(totalSupply),110*10**18);
            })

            it('fails to transfer mintkey to 0x0', async function () {
                await assertRevert(this.controller.transferMintKey("0x0000000000000000000000000000000000000000", { from: owner }))
            })


            it('non owner/mintkey cannot transfer mintkey', async function () {
                await assertRevert(this.controller.transferMintKey(oneHundred, { from: otherAddress }))
            })
        })

        describe('Emit Proper Event Logs', async function(){
            it("transfer mintkey should generate logs", async function(){
                const {logs} = await this.controller.transferMintKey(oneHundred, { from: owner })
                assert.equal(logs[0].event,"TransferMintKey");
                assert.equal(logs[0].args.previousMintKey,mintKey);
                assert.equal(logs[0].args.newMintKey,oneHundred);
            })

            it("pause mint should generate logs", async function(){
                const {logs} = await this.controller.pauseMints({ from: owner })
                assert.equal(logs[0].event,"AllMintsPaused");
                assert.equal(logs[0].args.status,true);
            })

            it("changing mint thresholds should generate logs", async function(){
                const {logs} = await this.controller.setMintThresholds(10*10**18,100*10**18,1000*10**18, { from: owner })
                assert.equal(logs[0].event,"MintThresholdChanged" )
                assert.equal(Number(logs[0].args.instant), 10*10**18)
                assert.equal(Number(logs[0].args.ratified), 100*10**18)
                assert.equal(Number(logs[0].args.multiSig), 1000*10**18)
            })

            it("changing mint limits should generate logs", async function(){
                const {logs} = await this.controller.setMintLimits(30*10**18,300*10**18,3000*10**18,{ from: owner })
                assert.equal(logs[0].event,"MintLimitsChanged" )
                assert.equal(Number(logs[0].args.instant), 30*10**18)
                assert.equal(Number(logs[0].args.ratified), 300*10**18)
                assert.equal(Number(logs[0].args.multiSig), 3000*10**18)
            })
        })

        describe('Full mint process', function () {
            beforeEach(async function () {
                await this.controller.setMintThresholds(10*10**18,100*10**18,1000*10**18, { from: owner })
                await this.controller.setMintLimits(30*10**18,300*10**18,3000*10**18,{ from: owner })
                await this.controller.refillMultiSigMintPool({ from: owner })
                await this.controller.refillRatifiedMintPool({ from: owner })
                await this.controller.refillInstantMintPool({ from: owner })
            })

            it('have enough approvals for mints', async function(){
                let result = await this.controller.hasEnoughApproval(1,50*10**18)
                assert.equal(result,true)
                result = await this.controller.hasEnoughApproval(1,200*10**18)
                assert.equal(result,false)
                result = await this.controller.hasEnoughApproval(3,200*10**18)
                assert.equal(result,true)
                result = await this.controller.hasEnoughApproval(3,2000*10**18)
                assert.equal(result,false)
                result = await this.controller.hasEnoughApproval(2,500*10**18)
                assert.equal(result,false)
                result = await this.controller.hasEnoughApproval(0,50*10**18)
                assert.equal(result,false)
            })

            it('owner can finalize before without approvals', async function(){
                await this.controller.requestMint(oneHundred, 10*10**18, { from: mintKey })
                await this.controller.ratifyMint(0, oneHundred, 10*10**18, { from: owner })
            })


            it('non ratifiers cannot ratify mints', async function () {
                await this.controller.requestMint(oneHundred, 10*10**18, { from: mintKey })
                await assertRevert(this.controller.ratifyMint(0, oneHundred, 10*10**18, { from: otherAddress }))
            })

            it('ratifier cannot ratify twice', async function () {
                await this.controller.requestMint(oneHundred, 200*10**18, { from: mintKey })
                await this.controller.ratifyMint(0, oneHundred, 200*10**18, { from: ratifier1 })
                await assertRevert(this.controller.ratifyMint(0, oneHundred, 200*10**18, { from: ratifier1 }))
            })

            it('ratify mint should generate logs', async function(){
                await this.controller.requestMint(oneHundred, 10*10**18, { from: mintKey })
                const {logs} = await this.controller.ratifyMint(0, oneHundred, 10*10**18, { from: ratifier1 })
                assert.equal(logs[0].event,"MintRatified")
                assert.equal(logs[0].args.ratifier,ratifier1)
                assert.equal(Number(logs[0].args.opIndex),0)
            })
    
            it('cannot approve the same mint twice', async function () {
                await this.controller.requestMint(oneHundred, 10*10**18 , { from: mintKey })
                await this.controller.ratifyMint(0, oneHundred, 10*10**18, { from: ratifier1 })
                await assertRevert(this.controller.ratifyMint(0, oneHundred, 10*10**18, { from: ratifier1 }))
            })

            it('cannot request mint when mint paused', async function () {
                await this.controller.pauseMints({ from: pauseKey })
                await assertRevert(this.controller.requestMint(oneHundred, 10*10**18 , { from: mintKey }))
            })

            it('non pause key cannot pause mint', async function () {
                await assertRevert(this.controller.pauseMints({ from: otherAddress }))
            })

            it('pause key cannot unpause', async function () {
                await assertRevert(this.controller.unpauseMints({ from: pauseKey }))
            })

            it('owner pauses then unpause then mints', async function () {
                await this.controller.pauseMints({ from: owner })
                await this.controller.unpauseMints({ from: owner })
                await this.controller.requestMint(oneHundred, 10*10**18 , { from: mintKey })
            })

            it('pauseKey2 should be able to pause mints by sending in ether', async function(){
                await this.fastPauseMints.sendTransaction({from: pauseKey2, gas: 600000, value: 10});                  
                let paused = await this.controller.mintPaused()    
                assert.equal(paused, true)
                await assertRevert(this.controller.requestMint(oneHundred, 10*10**18 , { from: mintKey }))
                await assertRevert(this.fastPauseMints.sendTransaction({from: pauseKey, gas: 600000, value: 10}));                  
                await this.controller.unpauseMints({ from: owner })
                paused = await this.controller.mintPaused()  
                assert.equal(paused, false)  
            })

            it('ratify fails when the amount does not match', async function() {
                await this.controller.requestMint(oneHundred, 10*10**18 , { from: mintKey })
                await assertRevert(this.controller.ratifyMint(0, oneHundred, 11*10**18, { from: ratifier1 }))
            })

            it('ratify fails when the to address does not match', async function() {
                await this.controller.requestMint(oneHundred, 10*10**18 , { from: mintKey })
                await assertRevert(this.controller.ratifyMint(0, otherAddress, 10*10**18, { from: ratifier1 }))
            })

            it('instant mint a small amount', async function() {
                const {logs} = await this.controller.instantMint(otherAddress, 10*10**18 , { from: mintKey })
                await assertBalance(this.token, otherAddress, 10*10**18)
            })

            it('cannot instant mint over the instant mint threshold', async function() {
                await assertRevert(this.controller.instantMint(otherAddress, 15*10**18 , { from: mintKey }))
            })

            it('cannot instant when the instant mint pool is dry', async function() {
                await this.controller.instantMint(otherAddress, 10*10**18 , { from: mintKey })
                await this.controller.instantMint(otherAddress, 10*10**18 , { from: mintKey })
                await this.controller.instantMint(otherAddress, 8*10**18 , { from: mintKey })
                await assertRevert(this.controller.instantMint(otherAddress, 5*10**18 , { from: mintKey }))
            })


            it('does the entire radify mint process', async function () {
                await this.controller.requestMint(otherAddress, 20*10**18 , { from: mintKey })
                await this.controller.ratifyMint(0, otherAddress, 20*10**18 , { from: ratifier1 })
                await assertBalance(this.token, otherAddress, 20*10**18)
                const remainRatifyPool = await this.controller.ratifiedMintPool()
                assert.equal(Number(remainRatifyPool),250*10**18)
            })

            it('single approval radify does not finalize if over the radifiedMintthreshold', async function () {
                await this.controller.requestMint(otherAddress, 200*10**18 , { from: mintKey })
                await this.controller.ratifyMint(0, otherAddress, 200*10**18 , { from: ratifier1 })
                await assertBalance(this.token, otherAddress, 0)
            })

            it('single approval radify mint does not finalize if over the radifiedMintPool is dry', async function () {
                await this.controller.requestMint(otherAddress, 100*10**18 , { from: mintKey })
                await this.controller.ratifyMint(0, otherAddress, 100*10**18 , { from: ratifier1 })
                await this.controller.requestMint(otherAddress, 100*10**18 , { from: mintKey })
                await this.controller.ratifyMint(1, otherAddress, 100*10**18 , { from: ratifier1 })
                await this.controller.requestMint(otherAddress, 30*10**18 , { from: mintKey })
                await this.controller.ratifyMint(2, otherAddress, 30*10**18 , { from: ratifier1 })
                await this.controller.requestMint(otherAddress, 50*10**18 , { from: mintKey })
                await this.controller.ratifyMint(3, otherAddress, 50*10**18 , { from: ratifier1 })
                await assertBalance(this.token, otherAddress, 230*10**18)
            })

            it('cannot finalize mint without enough approvers', async function(){
                await this.controller.requestMint(otherAddress, 50*10**18 , { from: mintKey })
                await assertRevert(this.controller.finalizeMint(0, {from : mintKey}))
                await this.controller.ratifyMint(0, otherAddress, 50*10**18 , { from: ratifier1 })
                await this.controller.requestMint(otherAddress, 500*10**18 , { from: mintKey })
                await this.controller.ratifyMint(1, otherAddress, 500*10**18 , { from: ratifier1 })
                await this.controller.ratifyMint(1, otherAddress, 500*10**18 , { from: ratifier2 })
                await assertRevert(this.controller.finalizeMint(1, {from : mintKey}))
                await this.controller.ratifyMint(1, otherAddress, 500*10**18 , { from: ratifier3 })
            })

            it('owner can finalize mint without ratifiers', async function(){
                await this.controller.requestMint(otherAddress, 50*10**18 , { from: mintKey })
                await this.controller.finalizeMint(0, {from : owner})
                await this.controller.requestMint(otherAddress, 500*10**18 , { from: mintKey })
                await this.controller.finalizeMint(1, {from : owner})
            })

            it('does the entire multiSig mint process', async function () {
                await this.controller.requestMint(otherAddress, 200*10**18 , { from: mintKey })
                await this.controller.ratifyMint(0, otherAddress, 200*10**18 , { from: ratifier1 })
                await this.controller.ratifyMint(0, otherAddress, 200*10**18 , { from: ratifier2 })
                await this.controller.ratifyMint(0, otherAddress, 200*10**18 , { from: ratifier3 })
                await assertBalance(this.token, otherAddress, 200*10**18)
                const remainMultiSigPool = await this.controller.multiSigMintPool()
                assert.equal(Number(remainMultiSigPool), 2500*10**18)
            })

            it('multiSig mint does not finalize if over the jumbpMintthreshold', async function () {
                await this.controller.requestMint(otherAddress, 2000*10**18 , { from: mintKey })
                await this.controller.ratifyMint(0, otherAddress, 2000*10**18 , { from: ratifier1 })
                await this.controller.ratifyMint(0, otherAddress, 2000*10**18 , { from: ratifier2 })
                await this.controller.ratifyMint(0, otherAddress, 2000*10**18 , { from: ratifier3 })
                await assertBalance(this.token, otherAddress, 0)
            })

            it('multiSig mint does not finalize if over the multiSigMintPool is dry', async function () {
                await this.controller.requestMint(otherAddress, 1000*10**18 , { from: mintKey })
                await this.controller.ratifyMint(0, otherAddress, 1000*10**18 , { from: ratifier1 })
                await this.controller.ratifyMint(0, otherAddress, 1000*10**18 , { from: ratifier2 })
                await this.controller.ratifyMint(0, otherAddress, 1000*10**18 , { from: ratifier3 })
                await this.controller.requestMint(otherAddress, 1000*10**18 , { from: mintKey })
                await this.controller.ratifyMint(1, otherAddress, 1000*10**18 , { from: ratifier1 })
                await this.controller.ratifyMint(1, otherAddress, 1000*10**18 , { from: ratifier2 })
                await this.controller.ratifyMint(1, otherAddress, 1000*10**18 , { from: ratifier3 })
                await this.controller.requestMint(otherAddress, 300*10**18 , { from: mintKey })
                await this.controller.ratifyMint(2, otherAddress, 300*10**18 , { from: ratifier1 })
                await this.controller.ratifyMint(2, otherAddress, 300*10**18 , { from: ratifier2 })
                await this.controller.ratifyMint(2, otherAddress, 300*10**18 , { from: ratifier3 })
                await this.controller.requestMint(otherAddress, 500*10**18 , { from: mintKey })
                await this.controller.ratifyMint(3, otherAddress, 500*10**18 , { from: ratifier1 })
                await this.controller.ratifyMint(3, otherAddress, 500*10**18 , { from: ratifier2 })
                await this.controller.ratifyMint(3, otherAddress, 500*10**18 , { from: ratifier3 })
                await assertBalance(this.token, otherAddress, 2300*10**18)
            })

            it('owner can mint unlimited amount', async function () {
                await this.controller.requestMint(oneHundred, 10000*10**18, { from: mintKey })
                await this.controller.ratifyMint(0, oneHundred, 10000*10**18, { from: owner })
            })

            it('pause key can pause specific mint', async function() {
                await this.controller.requestMint(oneHundred, 10*10**18, { from: mintKey })
                await this.controller.pauseMint(0, { from: pauseKey })
                await assertRevert(this.controller.ratifyMint(0, oneHundred, 10*10**18, { from: ratifier1 }))
            })

            it('pause key cannot unpause specific mint', async function() {
                await this.controller.requestMint(oneHundred, 10*10**18, { from: mintKey })
                await this.controller.pauseMint(0, { from: pauseKey })
                await assertRevert(this.controller.unpauseMint(0, { from: pauseKey }))               
            })

            it('owner can unpause specific mint', async function() {
                await this.controller.requestMint(oneHundred, 10*10**18, { from: mintKey })
                await this.controller.pauseMint(0, { from: pauseKey })
                await this.controller.unpauseMint(0, { from: owner })     
                await this.controller.ratifyMint(0, oneHundred, 10*10**18, { from: ratifier1 })
            })

            it('cannot finalize after all request invalidated', async function() {
                await this.controller.requestMint(oneHundred, 10*10**18, { from: mintKey })
                await this.controller.requestMint(oneHundred, 10*10**18, { from: mintKey })
                await this.controller.invalidateAllPendingMints({from: owner})
                await assertRevert(this.controller.ratifyMint(0, oneHundred, 10*10**18, { from: ratifier1 }))
                await assertRevert(this.controller.ratifyMint(1, oneHundred, 10*10**18, { from: ratifier1 }))
            })
        })

        describe('refill mint pool', function(){
            beforeEach(async function () {
                await this.controller.setMintThresholds(10*10**18,100*10**18,1000*10**18, { from: owner })
                await this.controller.setMintLimits(30*10**18,300*10**18,3000*10**18,{ from: owner })
            })

            it('refills multiSig mint pool', async function(){
                const { logs }= await this.controller.refillMultiSigMintPool({ from: owner })
                assert.equal(logs[0].event,"MultiSigPoolRefilled")
                const multiSigPool = await this.controller.multiSigMintPool()
                assert.equal(Number(multiSigPool), 3000*10**18)
            })

            it('refills ratify mint pool', async function(){
                await this.controller.refillMultiSigMintPool({ from: owner })
                await this.controller.refillRatifiedMintPool({ from: ratifier1 })
                await this.controller.refillRatifiedMintPool({ from: ratifier2 })
                const { logs } = await this.controller.refillRatifiedMintPool({ from: ratifier3 })
                assert.equal(logs[0].event,"RadifyPoolRefilled")
                const ratifyPool = await this.controller.ratifiedMintPool()
                assert.equal(Number(ratifyPool), 300*10**18)
                const multiSigPool = await this.controller.multiSigMintPool()
                assert.equal(Number(multiSigPool), 2700*10**18)
            })

            it('refills instant mint pool', async function(){
                await this.controller.refillMultiSigMintPool({ from: owner })
                await this.controller.refillRatifiedMintPool({ from: owner })
                const { logs } = await this.controller.refillInstantMintPool({ from: owner })
                assert.equal(logs[0].event,"InstantPoolRefilled")
                const ratifyPool = await this.controller.ratifiedMintPool()
                assert.equal(Number(ratifyPool), 270*10**18)
                const multiSigPool = await this.controller.multiSigMintPool()
                assert.equal(Number(multiSigPool), 2700*10**18)
                const instantPool = await this.controller.instantMintPool()
                assert.equal(Number(instantPool), 30*10**18)
            })

            it('Ratifier cannot refill RatifiedMintPool alone', async function(){
                await this.controller.refillMultiSigMintPool({ from: owner })
                await this.controller.refillRatifiedMintPool({ from: ratifier1 })
                await this.controller.refillRatifiedMintPool({ from: ratifier2 })
                await assertRevert(this.controller.refillRatifiedMintPool({ from: ratifier1 }))
                await assertRevert(this.controller.refillRatifiedMintPool({ from: ratifier2 }))
            })

            it('can finalize mint after refill', async function(){
                await this.controller.refillMultiSigMintPool({ from: owner })
                await this.controller.requestMint(otherAddress, 1000*10**18 , { from: mintKey })
                await this.controller.ratifyMint(0, otherAddress, 1000*10**18 , { from: ratifier1 })
                await this.controller.ratifyMint(0, otherAddress, 1000*10**18 , { from: ratifier2 })
                await this.controller.ratifyMint(0, otherAddress, 1000*10**18 , { from: ratifier3 })
                await this.controller.requestMint(otherAddress, 1000*10**18 , { from: mintKey })
                await this.controller.ratifyMint(1, otherAddress, 1000*10**18 , { from: ratifier1 })
                await this.controller.ratifyMint(1, otherAddress, 1000*10**18 , { from: ratifier2 })
                await this.controller.ratifyMint(1, otherAddress, 1000*10**18 , { from: ratifier3 })
                await this.controller.requestMint(otherAddress, 800*10**18 , { from: mintKey })
                await this.controller.ratifyMint(2, otherAddress, 800*10**18 , { from: ratifier1 })
                await this.controller.ratifyMint(2, otherAddress, 800*10**18 , { from: ratifier2 })
                await this.controller.ratifyMint(2, otherAddress, 800*10**18 , { from: ratifier3 })
                await this.controller.requestMint(otherAddress, 500*10**18 , { from: mintKey })
                await this.controller.ratifyMint(3, otherAddress, 500*10**18 , { from: ratifier1 })
                await this.controller.ratifyMint(3, otherAddress, 500*10**18 , { from: ratifier2 })
                await this.controller.ratifyMint(3, otherAddress, 500*10**18 , { from: ratifier3 })
                await assertBalance(this.token, otherAddress, 2800*10**18)
                await this.controller.refillMultiSigMintPool({ from: owner })
                await this.controller.finalizeMint(3, {from : mintKey})
                await assertBalance(this.token, otherAddress, 3300*10**18)
            })
        })

        describe('initialization', function(){
            it('controller cannot be re-initialized', async function () {
                await assertRevert(this.controller.initialize({from:owner}))
            })
        })

        describe('transfer child', function(){
            it('can transfer trueUSD ownership to another address', async function () {
                await this.controller.transferChild(this.token.address, owner,{from:owner})
                const pendingOwner = await this.token.pendingOwner();
                assert.equal(pendingOwner,owner)
            })
        })

        describe('changeTokenName', function () {
            it('sets the token name', async function () {
                await this.controller.changeTokenName("FooCoin", "FCN", { from: owner })

                const name = await this.token.name()
                assert.equal(name, "FooCoin")
                const symbol = await this.token.symbol()
                assert.equal(symbol, "FCN")
            })

            it('cannot be called by non-owner', async function () {
                await assertRevert(this.controller.changeTokenName("FooCoin", "FCN", { from: otherAddress }))
            })
        })

        describe('setBurnBounds', function () {
            it('sets burnBounds', async function () {
                await this.controller.setBurnBounds(3*10**18, 4*10**18, { from: owner })

                const min = await this.token.burnMin()
                assert.equal(min, 3*10**18)
                const max = await this.token.burnMax()
                assert.equal(max, 4*10**18)
            })

            it('cannot be called by non Owner', async function () {
                await assertRevert(this.controller.setBurnBounds(3*10**18, 4*10**18, { from: otherAddress }))
            })

            it('cannot be called by non Owner', async function () {
                await assertRevert(this.controller.setBurnBounds(3*10**18, 4*10**18, { from: otherAddress }))
            })
        })

        describe('redemption addresses', function (){
            it('owner and redemption Admin can increment Redemption Address Count', async function(){
                await this.registry.setAttribute(redemptionAdmin, "isTUSDRedemptionAdmin", 1, "notes", { from: owner })
                await this.controller.incrementRedemptionAddressCount({from: owner})
                await this.controller.incrementRedemptionAddressCount({from: redemptionAdmin})
                const redemptionAddressCount = Number(await this.token.redemptionAddressCount())
                assert.equal(redemptionAddressCount,2)
            })
            it('other addresses cannot increment Redemption Address Count', async function(){
                await assertRevert(this.controller.incrementRedemptionAddressCount({from: oneHundred}))
            })
        })


        describe('pause trueUSD and wipe accounts', function(){
            beforeEach(async function(){
                this.fastPauseTrueUSD = await FastPauseTrueUSD.new(pauseKey, this.controller.address, { from: owner })
                await this.controller.setTrueUsdFastPause(this.fastPauseTrueUSD.address, { from: owner })
            })

            it('TokenController can pause TrueUSD transfers', async function(){
                await this.token.transfer(mintKey, 10*10**18, { from: oneHundred })
                await this.controller.pauseTrueUSD({ from: owner })
                await assertRevert(this.token.transfer(mintKey, 40*10**18, { from: oneHundred }))
            })

            it('TokenController can unpause TrueUSD transfers', async function(){
                await this.controller.pauseTrueUSD({ from: owner })
                await assertRevert(this.token.transfer(mintKey, 40*10**18, { from: oneHundred }))
                await this.controller.unpauseTrueUSD({ from: owner })
                await this.token.transfer(mintKey, 40*10**18, { from: oneHundred })
            })

            it('trueUsdPauser can pause TrueUSD by sending ether to fastPause contract', async function(){
                await this.fastPauseTrueUSD.sendTransaction({from: pauseKey, gas: 600000, value: 10});                  
                const paused = await this.token.paused();
                assert.equal(paused, true)               
            })

            it('non pauser cannot pause TrueUSD ', async function(){
                await assertRevert(this.controller.pauseTrueUSD({ from: mintKey }));                  
            })

            it('non pauser cannot pause TrueUSD by sending ether to fastPause contract', async function(){
                await assertRevert(this.fastPauseTrueUSD.sendTransaction({from: pauseKey2, gas: 600000, value: 10}));                  
            })

            it('TokenController can wipe blacklisted account', async function(){
                await this.token.transfer(this.token.address, 40*10**18, { from: oneHundred })
                await assertBalance(this.token, this.token.address, 40000000000000000000)
                await this.registry.setAttribute(this.token.address, "isBlacklisted", 1, "notes", { from: owner })
                await this.controller.wipeBlackListedTrueUSD(this.token.address, { from: owner })
                await assertBalance(this.token, this.token.address, 0)
            })

            it('tokenController can set GlobalPause', async function(){
                this.globalPause = await GlobalPause.new({ from: owner })
                await this.globalPause.pauseAllTokens(true, "Unsupported fork", { from: owner })
                await this.controller.setGlobalPause(this.globalPause.address, { from: owner })
                await assertRevert(this.token.transfer(mintKey, 40*10**18, { from: oneHundred }))
                await this.globalPause.pauseAllTokens(false, "", { from: owner })
                await this.token.transfer(mintKey, 40*10**18, { from: oneHundred })
            })
        })
        describe('Claim storage contracts', function () {
            it('can claim storage contracts for TrueUSD', async function () {
                this.tempBalanceSheet = await BalanceSheet.new({from: owner})
                this.tempAllowanceSheet = await AllowanceSheet.new({from: owner})
                await this.tempBalanceSheet.transferOwnership(this.token.address, {from: owner})
                await this.tempAllowanceSheet.transferOwnership(this.token.address, {from: owner})
                await this.controller.claimStorageForProxy(this.token.address, this.tempBalanceSheet.address, this.tempAllowanceSheet.address,{from: owner})
            })

            it('fails when TrueUSD is not the pending owner of storage contracts', async function () {
                this.tempBalanceSheet = await BalanceSheet.new({from: owner})
                this.tempAllowanceSheet = await AllowanceSheet.new({from: owner})
                await assertRevert(this.controller.claimStorageForProxy(this.token.address, this.tempBalanceSheet.address, this.tempAllowanceSheet.address,{from: owner}))
            })

            it('fails when TrueUSD is not the pending owner of one of the storage contracts', async function () {
                this.tempBalanceSheet = await BalanceSheet.new({from: owner})
                this.tempAllowanceSheet = await AllowanceSheet.new({from: owner})
                await this.tempBalanceSheet.transferOwnership(this.token.address, {from: owner})
                await assertRevert(this.controller.claimStorageForProxy(this.token.address, this.tempBalanceSheet.address, this.tempAllowanceSheet.address,{from: owner}))
            })
        })


        describe('requestReclaimContract', function () {
            it('reclaims the contract', async function () {
                const balances = await this.token.balances()
                let balanceOwner = await BalanceSheet.at(balances).owner()
                assert.equal(balanceOwner, this.token.address)

                await this.controller.requestReclaimContract(balances, { from: owner })
                await this.controller.issueClaimOwnership(balances, { from: owner })
                balanceOwner = await BalanceSheet.at(balances).owner()
                assert.equal(balanceOwner, this.controller.address)
            })

            it('emits an event', async function () {
                const balances = await this.token.balances()
                const { logs } = await this.controller.requestReclaimContract(balances, { from: owner })

                assert.equal(logs.length, 1)
                assert.equal(logs[0].event, 'RequestReclaimContract')
                assert.equal(logs[0].args.other, balances)
            })

            it('cannot be called by non-owner', async function () {
                const balances = await this.token.balances()
                await assertRevert(this.controller.requestReclaimContract(balances, { from: mintKey }))
            })
        })

        describe('fall back function', function(){
            it('controller does not accept ether', async function(){
                await assertRevert(this.controller.sendTransaction({from: oneHundred, gas: 600000, value: 10}));
            })
        })

        describe('requestReclaimEther', function () {
            it('reclaims ether', async function () {
                const forceEther = await ForceEther.new({ from: oneHundred, value: "10000000000000000000" })
                await forceEther.destroyAndSend(this.token.address)
                const balance1 = web3.fromWei(web3.eth.getBalance(owner), 'ether').toNumber()
                await this.controller.requestReclaimEther({ from: owner })
                const balance2 = web3.fromWei(web3.eth.getBalance(owner), 'ether').toNumber()
                assert.isAbove(balance2, balance1)
            })

            it('cannot be called by non-owner', async function () {
                const forceEther = await ForceEther.new({ from: oneHundred, value: "10000000000000000000" })
                await forceEther.destroyAndSend(this.token.address)
                await assertRevert(this.controller.requestReclaimEther({ from: otherAddress }))
            })

            it('can reclaim ether in the controller contract address',  async function () {
                const forceEther = await ForceEther.new({ from: oneHundred, value: "10000000000000000000" })
                await forceEther.destroyAndSend(this.controller.address)
                const balance1 = web3.fromWei(web3.eth.getBalance(owner), 'ether').toNumber()
                await this.controller.reclaimEther(owner, { from: owner })
                const balance2 = web3.fromWei(web3.eth.getBalance(owner), 'ether').toNumber()
                assert.isAbove(balance2, balance1)
            })
        })

        describe('requestReclaimToken', function () {
            it('reclaims token', async function () {
                await this.token.transfer(this.token.address, 40*10**18, { from: oneHundred })
                await this.controller.requestReclaimToken(this.token.address, { from: owner })
                await assertBalance(this.token, owner, 40*10**18)
            })

            it('cannot be called by non-owner', async function () {
                await this.token.transfer(this.token.address, 40*10**18, { from: oneHundred })
                await assertRevert(this.controller.requestReclaimToken(this.token.address, { from: otherAddress }))
            })

            it('can reclaim token in the controller contract address',  async function () {
                await this.token.transfer(this.controller.address, 40*10**18, { from: oneHundred })
                await this.controller.reclaimToken(this.token.address, owner, { from: owner })
                await assertBalance(this.token, owner, 40*10**18)
            })
        })
    })
})