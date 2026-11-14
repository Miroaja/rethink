import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/F_V8_Y___W.B_2QEUK'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf, hex } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const MODEL_ID = 'F_V8_Y___W.B_2QEUK'
const META: Metadata = { modelId: MODEL_ID, modelName: 'F_V8_Y___W.B_2QEUK', swVersion: '0.0.0' }

// All hex dumps below are captured status telegrams from issue #75 (F6WV710P2S.ABLQPDG).
// The decoder parses the second record (starting at buf[42]); the option state lives at
// buf[50] (wash intensity), buf[53] (extra rinse count) and the buf[57] options bitfield.

// Cotton, 40°C, 1600 RPM — no extra options selected.
const SAMPLE_COTTON_STD = buf(
    'aa5420ec002501000000000000000000000000000000000000000001006400000000000000000000000000002501033a033a0100030b04010000000000010002000001006400000400000000000000000000e0bb',
)

// Allergy Care, 60°C, Steam, 1600 RPM.
const SAMPLE_ALLERGY_STEAM = buf(
    'aa5420ec002501021c021c0900030504010000000000000002000001006400000500000000000000000000002501023002302d00030b06010000008000000003000001006400000500000000000000000000f2bb',
)

// Cotton, 60°C, Steam, 1600 RPM.
const SAMPLE_COTTON_STEAM = buf(
    'aa5420ec002501031c031c0100030b03010000000000010002000001006400000400000000000000000000002501041104110100030b0601000000800001000300000100640000040000000000000000000015bb',
)

// Cotton with TurboWash pressed (auto-adjusts to 1000 RPM).
const SAMPLE_TURBOWASH = buf(
    'aa5420ec002501041104110100030b06010000008000010003000001006400000400000000000000000000002501031d031d010003070601000000010001000300000100640000040000000000000000000016bb',
)

// Cotton with Rinse+ pressed (extra rinse count -> 2).
const SAMPLE_RINSE_PLUS = buf(
    'aa5420ec002501033703370100030706010000000000010004000001006400000400000000000000000000002501040c040c0100030706020000000000010004000001006400000500000000000000000000b9bb',
)

// Cotton with Pre-wash pressed.
const SAMPLE_PREWASH = buf(
    'aa5420ec002501033703370100030706010000000000010004000001006400000400000000000000000000002501040c040c01000307060100000040000100040000010064000005000000000000000000007ebb',
)

// Cotton with Intensive Wash pressed (wash intensity -> 4).
const SAMPLE_INTENSIVE = buf(
    'aa5420ec002501033703370100030706010000000000010004000001006400000400000000000000000000002501041604160100040706010000000000010004000001006400000400000000000000000000aabb',
)

// Captured from an FV90VNS2QE through the management panel's device monitor. The LG app downloads
// Sweat Stain as Cotton, normal soil, Max spin, 40 °C and normal rinse. This frame reports the
// washer changing from a download with steam on to the plain download of Sweat Stain at 800 rpm,
// 60 °C and Rinse+; its replacing block is the settled state.
const DOWNLOADED_SWEAT_STAIN = buf(
    'aa5420ec002501041604160100030506020000008000010004003b27003b00000500000000000000000000002501040304030100030506020000000000010004003b27003b00000500000000000000000000ddbb',
)

// What the LG app sent for that download, as seen over the bridge.
const APP_DOWNLOAD_SWEAT_STAIN = 'AA18F02503150103FF0401000000000000003B00000067BB'

// Packets injected from the monitor, all acknowledged by the washer: 800 rpm, 60 °C and Rinse+
// with the options byte as noted. The first three were followed by status blocks that agreed.
const DOWNLOAD_NO_OPTIONS = 'AA18F02503150103050602000000000000003B0000006EBB'
const DOWNLOAD_PREWASH = 'AA18F02503150103050602000000004000003B0000002EBB'
const DOWNLOAD_STEAM = 'AA18F02503150103050602000000008000003B000000EEBB'
// All three options at once; the LG app showed each of them on.
const DOWNLOAD_ALL_OPTIONS = 'AA18F0250315010305060200000000C100003B000000A9BB'

// The same unit, later. Each status block is the washer's report after a packet from the
// monitor: a download with soil level Intensive, one with the rinse set to Normal + Hold, and a
// delayed start of three hours, reported with 2:59 of it left.
const SOIL_INTENSIVE_STATUS = buf(
    'aa5420ec002501000000000000000000000000000000000000000027003b00000000000000000000000000002501041b041b0100040506020000000000010004003b27003b00000500000000000000000000fabb',
)
const RINSE_NORMAL_HOLD_STATUS = buf(
    'aa5420ec002501041104110100030506030000000000010004003b27003b00000500000000000000000000002501033103310100030506040000000000010004003b27003b000004000000000000000000000fbb',
)
const DELAY_COUNTDOWN_STATUS = buf(
    'aa5420ec002503012301230100030506020003000040210001043b27003b000004000000000000000000000025030123012301000305060200023b0040210001043b27003b000004000000000000000000000fbb',
)

// Downloads as above, 800 rpm and 60 °C, with one setting changed from the baseline's soil Normal
// and Rinse+, as the washer then reported it.
const DOWNLOAD_SOIL_INTENSIVE = 'AA18F02503150104050602000000000000003B00000069BB'
const DOWNLOAD_SOIL_TIME_SAVE = 'AA18F02503150102050602000000000000003B0000006FBB'
const DOWNLOAD_SOIL_TURBOWASH = 'AA18F02503150101050602000000000000003B0000006CBB'
const DOWNLOAD_RINSE_PLUSPLUS = 'AA18F02503150103050603000000000000003B00000069BB'
const DOWNLOAD_RINSE_NORMAL_HOLD = 'AA18F02503150103050604000000000000003B00000068BB'
const DOWNLOAD_RINSE_PLUS_HOLD = 'AA18F02503150103050605000000000000003B0000006BBB'

// The programme above started with a three hour delay; the washer acknowledged it and went to
// Delayed.
const START_DELAYED_3H = 'AA16F0260103050602000300000003003B0000007DBB'

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev }
}

describe(MODEL_ID, () => {
    test('Cotton 40°C 1600 RPM decodes with no options set', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_COTTON_STD)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.course, 'Cotton')
        assert.equal(props.temp, '40 °C')
        assert.equal(props.spin, '1600 rpm')
        assert.equal(props.extra_rinse, 'OFF')
        assert.equal(props.turbowash, 'OFF')
        assert.equal(props.prewash, 'OFF')
        assert.equal(props.steam, 'OFF')
        assert.equal(props.soil, 'Normal')
    })

    test('Allergy Care 60°C Steam 1600 RPM decodes steam=ON', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_ALLERGY_STEAM)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.course, 'Allergy Care')
        assert.equal(props.temp, '60 °C')
        assert.equal(props.spin, '1600 rpm')
        assert.equal(props.steam, 'ON')
        assert.equal(props.turbowash, 'OFF')
        assert.equal(props.prewash, 'OFF')
        assert.equal(props.extra_rinse, 'OFF')
        assert.equal(props.soil, 'Normal')
    })

    test('Cotton 60°C Steam decodes steam=ON', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_COTTON_STEAM)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.course, 'Cotton')
        assert.equal(props.temp, '60 °C')
        assert.equal(props.steam, 'ON')
        assert.equal(props.turbowash, 'OFF')
    })

    test('TurboWash decodes turbowash=ON and 1000 RPM', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_TURBOWASH)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.turbowash, 'ON')
        assert.equal(props.spin, '1000 rpm')
        assert.equal(props.steam, 'OFF')
        assert.equal(props.prewash, 'OFF')
        assert.equal(props.extra_rinse, 'OFF')
        assert.equal(props.soil, 'Normal')
    })

    test('Rinse+ decodes extra_rinse=ON', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_RINSE_PLUS)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.extra_rinse, 'ON')
        assert.equal(props.turbowash, 'OFF')
        assert.equal(props.prewash, 'OFF')
        assert.equal(props.steam, 'OFF')
        assert.equal(props.soil, 'Normal')
    })

    test('Pre-wash decodes prewash=ON', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_PREWASH)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.prewash, 'ON')
        assert.equal(props.turbowash, 'OFF')
        assert.equal(props.steam, 'OFF')
        assert.equal(props.extra_rinse, 'OFF')
        assert.equal(props.soil, 'Normal')
    })

    test('Intensive Wash decodes soil=Intensive', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_INTENSIVE)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.soil, 'Intensive')
        assert.equal(props.turbowash, 'OFF')
        assert.equal(props.prewash, 'OFF')
        assert.equal(props.steam, 'OFF')
        assert.equal(props.extra_rinse, 'OFF')
    })
    describe('downloading a programme', () => {
        function lastSent(thinq: MockThinq2Device) {
            return hex(thinq.outbox[thinq.outbox.length - 1])
        }

        test('the settings of the downloaded programme are offered back', () => {
            const { ha, thinq } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            const props = ha.devices[DEVICE_ID].properties
            assert.equal(props.set_temp, '60 °C')
            assert.equal(props.set_spin, '800 rpm')
            assert.equal(props.set_rinse, 'Rinse+')
            assert.equal(props.set_turbowash, 'OFF')
            assert.equal(props.set_prewash, 'OFF')
            assert.equal(props.set_steam, 'OFF')
        })

        test('an untouched download resends what the appliance reports', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            thinq.resetRecorder()
            dev.setProperty('download_programme', '')
            assert.equal(lastSent(thinq), DOWNLOAD_NO_OPTIONS)
        })

        test('the assembled command matches the one the LG app sends', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            thinq.resetRecorder()
            dev.setProperty('set_spin', 'Max')
            dev.setProperty('set_temp', '40 °C')
            dev.setProperty('set_rinse', 'Normal')
            dev.setProperty('download_programme', '')
            assert.equal(lastSent(thinq), APP_DOWNLOAD_SWEAT_STAIN)
        })

        test('option switches set their own bit, alone or together', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            thinq.resetRecorder()

            dev.setProperty('set_prewash', 'ON')
            dev.setProperty('download_programme', '')
            assert.equal(lastSent(thinq), DOWNLOAD_PREWASH)

            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            dev.setProperty('set_steam', 'ON')
            dev.setProperty('download_programme', '')
            assert.equal(lastSent(thinq), DOWNLOAD_STEAM)

            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            dev.setProperty('set_turbowash', 'ON')
            dev.setProperty('set_prewash', 'ON')
            dev.setProperty('set_steam', 'ON')
            dev.setProperty('download_programme', '')
            assert.equal(lastSent(thinq), DOWNLOAD_ALL_OPTIONS)
        })

        test('a chosen setting shows at once and is released after the download', () => {
            const { ha, thinq, dev } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            dev.setProperty('set_steam', 'ON')
            assert.equal(ha.devices[DEVICE_ID].properties.set_steam, 'ON')

            dev.setProperty('download_programme', '')
            assert.equal(ha.devices[DEVICE_ID].properties.set_steam, 'OFF')
        })

        test('a value outside the selectable lists is ignored', () => {
            const { ha, thinq, dev } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            thinq.resetRecorder()
            dev.setProperty('set_spin', '1600 rpm')
            assert.equal(ha.devices[DEVICE_ID].properties.set_spin, '800 rpm')
            dev.setProperty('download_programme', '')
            assert.equal(lastSent(thinq), DOWNLOAD_NO_OPTIONS)
        })

        test('the rinse level is read back under the same labels as the select', () => {
            const { ha, thinq } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            assert.equal(ha.devices[DEVICE_ID].properties.rinse, 'Rinse+')
            thinq.emit('data', SAMPLE_COTTON_STD)
            assert.equal(ha.devices[DEVICE_ID].properties.rinse, 'Normal')
        })

        test('staged choices survive the same programme being reported again, not a different one', () => {
            const { ha, thinq, dev } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            dev.setProperty('set_steam', 'ON')
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            assert.equal(ha.devices[DEVICE_ID].properties.set_steam, 'ON')

            thinq.emit('data', SAMPLE_COTTON_STD) // another course selected, another slot content
            assert.equal(ha.devices[DEVICE_ID].properties.set_steam, 'OFF')
        })

        test('soil levels are read back and sent as the LG app shows them', () => {
            const { ha, thinq, dev } = makeDevice()
            thinq.emit('data', SOIL_INTENSIVE_STATUS)
            assert.equal(ha.devices[DEVICE_ID].properties.soil, 'Intensive')
            assert.equal(ha.devices[DEVICE_ID].properties.set_soil, 'Intensive')

            const cases: [string, string][] = [
                ['Intensive', DOWNLOAD_SOIL_INTENSIVE],
                ['Time save', DOWNLOAD_SOIL_TIME_SAVE],
                ['TurboWash', DOWNLOAD_SOIL_TURBOWASH],
            ]
            for (const [soil, packet] of cases) {
                thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
                thinq.resetRecorder()
                dev.setProperty('set_soil', soil)
                dev.setProperty('download_programme', '')
                assert.equal(lastSent(thinq), packet, soil)
            }
        })

        test('every rinse level is read back and sent as the LG app shows it', () => {
            const { ha, thinq, dev } = makeDevice()
            thinq.emit('data', RINSE_NORMAL_HOLD_STATUS)
            assert.equal(ha.devices[DEVICE_ID].properties.rinse, 'Normal + Hold')
            assert.equal(ha.devices[DEVICE_ID].properties.set_rinse, 'Normal + Hold')

            const cases: [string, string][] = [
                ['Rinse++', DOWNLOAD_RINSE_PLUSPLUS],
                ['Normal + Hold', DOWNLOAD_RINSE_NORMAL_HOLD],
                ['Rinse+ + Hold', DOWNLOAD_RINSE_PLUS_HOLD],
            ]
            for (const [rinse, packet] of cases) {
                thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
                thinq.resetRecorder()
                dev.setProperty('set_rinse', rinse)
                dev.setProperty('download_programme', '')
                assert.equal(lastSent(thinq), packet, rinse)
            }
        })

        test('the delay left is read as minutes', () => {
            const { ha, thinq } = makeDevice()
            thinq.emit('data', DELAY_COUNTDOWN_STATUS)
            assert.equal(ha.devices[DEVICE_ID].properties.status, 'Delayed')
            assert.equal(ha.devices[DEVICE_ID].properties.reserve_time, 2 * 60 + 59)
        })

        test('nothing is sent before the appliance has reported', () => {
            const { thinq, dev } = makeDevice()
            thinq.resetRecorder()
            dev.setProperty('download_programme', '')
            assert.equal(thinq.outbox.length, 0)
        })

        test('nothing is sent while the downloaded programme is not the selected one', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', SAMPLE_COTTON_STD) // a dial course, with the slot holding another programme
            thinq.resetRecorder()
            dev.setProperty('download_programme', '')
            assert.equal(thinq.outbox.length, 0)
        })
    })
    describe('running a programme', () => {
        function lastSent(thinq: MockThinq2Device) {
            return hex(thinq.outbox[thinq.outbox.length - 1])
        }

        // packet[10] is the delay in hours: AA, length, F0, 26, then course, soil, spin, temp,
        // rinse and dryLevel.
        const delayOf = (thinq: MockThinq2Device) => thinq.outbox[thinq.outbox.length - 1][10]

        test('the assembled command matches the delayed start the appliance accepted', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            thinq.resetRecorder()
            dev.setProperty('set_delay_end', '3')
            dev.setProperty('run_programme', '')
            assert.equal(lastSent(thinq), START_DELAYED_3H)
        })

        test('only a delay the appliance accepts is staged', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            thinq.resetRecorder()

            for (const invalid of ['1', '2', '20', '3.5', 'soon']) {
                dev.setProperty('set_delay_end', invalid)
                dev.setProperty('run_programme', '')
                assert.equal(delayOf(thinq), 0, invalid)
            }

            dev.setProperty('set_delay_end', '19')
            dev.setProperty('run_programme', '')
            assert.equal(delayOf(thinq), 19)
        })

        test('a delay stays staged through a download and is spent by the run', () => {
            const { ha, thinq, dev } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            dev.setProperty('set_delay_end', '3')
            dev.setProperty('download_programme', '')
            assert.equal(ha.devices[DEVICE_ID].properties.set_delay_end, 3)

            thinq.resetRecorder()
            dev.setProperty('run_programme', '')
            assert.equal(delayOf(thinq), 3)
            assert.equal(ha.devices[DEVICE_ID].properties.set_delay_end, 0)
        })

        test('nothing runs while the downloaded programme is not the selected one', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', SAMPLE_COTTON_STD)
            thinq.resetRecorder()
            dev.setProperty('run_programme', '')
            assert.equal(thinq.outbox.length, 0)
        })
    })
})
