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

// The washer switched on at the panel: standby, no programme selected, no settings reported, and
// the downloaded programme still in the slot. The download at DOWNLOAD_SOIL_INTENSIVE, sent in
// this state, selected the programme and set it up.
const WOKEN_STATUS = buf(
    'aa5420ec002500000000000000000000000000000000000000010000003b00000000000000000000000000002501000000000000000000000000000000000000000027003b00000000000000000000000000a6bb',
)

// The same unit while it was off and its reports were being restarted, with the slot empty.
const EMPTY_SLOT_STATUS = buf(
    'aa5420ec002500040304030000000000000000000000010004010027003b0000010000000000000000000000250000000000000000000000000000000000000001000000000000000000000000000000000099bb',
)

// The washer reporting 1400 rpm, which is what it reports for Max as well, after a download
// that changed the spin from 1200 rpm; and the download that set it.
const SPIN_1400_STATUS = buf(
    'aa5420ec002501040d040d0100030906020000000000010004003b27003b00000500000000000000000000002501041004100100030a06020000000000010004003b27003b0000050000000000000000c0008cbb',
)
const DOWNLOAD_SPIN_1400 = 'AA18F025031501030A0602000000000000003B00000015BB'

// The washer's report after the download of Baby Care below, which replaced Sweat Stain in the slot.
const BABY_CARE_STATUS = buf(
    'aa5420ec002501040304030000000000000000000000010004000027003b000001000000000000000000000025010432043201000307060200000050000100050047270047000005000000000000000000000ebb',
)

// Every programme the LG app can download into this model, downloaded from the monitor to a unit
// that had Sweat Stain at 800 rpm, 60 °C and Rinse+ selected. Each came back with its ID in the
// status block and the name the LG app showed for it.
const PROGRAMME_DOWNLOADS: [string, string][] = [
    ['Baby Care', 'AA18F025031501030706020000000050000047000000CCBB'],
    ['Blanket', 'AA18F02503150503020101000000000000003A00000060BB'],
    ['Cold Wash', 'AA18F02503150103FF0101000000000000004D00000014BB'],
    ['Colour Protection', 'AA18F02503152003050201000000000000003F0000000CBB'],
    ['Drain', 'AA18F025031517000100000000000000000079000000D5BB'],
    ['Gym Clothes', 'AA18F0250315080305010100000000000000380000006CBB'],
    ['Hygiene', 'AA18F02503152D03FF06010000000080000048000000B8BB'],
    ['Jeans', 'AA18F02503152003FF0201000000000000003900000018BB'],
    ['Juice and Food Stains', 'AA18F02503150103070401000000004000006C000000FEBB'],
    ['Kids Wear', 'AA18F02503150103090601000000004000003400000022BB'],
    ['Lightly Soiled Items', 'AA18F02503151B03020201000000000000006500000022BB'],
    ['Lingerie', 'AA18F02503152003050201000000000000004A00000031BB'],
    ['Minimize Detergent Residue', 'AA18F02503150103FF040200000000000000660000000BBB'],
    ['Minimize Wrinkles', 'AA18F02503150103FF0401000000000000006F00000033BB'],
    ['Noise Minimize', 'AA18F02503150903070401000000000000004000000012BB'],
    ['Quick Tub Clean', 'AA18F025031530030201000000000000000071000000C3BB'],
    ['Rainy Season', 'AA18F02503150103FF040100000000000000370000007BBB'],
    ['Rinse + Spin', 'AA18F02503150E03FF0001000000000000006400000031BB'],
    ['School Uniform', 'AA18F02503150203070401000000000000003500000060BB'],
    ['Single Garment', 'AA18F02503150C03020201000000000100003E00000017BB'],
    ['Skin Care', 'AA18F02503150103FF0402000000001000004C00000001BB'],
    ['Sleeve Hems and Collars', 'AA18F02503150103070601000000004000006B000000F9BB'],
    ['Small Load', 'AA18F02503150C03020201000000000100004900000018BB'],
    ['Spin', 'AA18F02503151700FF0000000000000000007A0000002ABB'],
    ['Sweat Stain', 'AA18F02503150103FF0401000000000000003B00000067BB'],
    ['Swimming Wear', 'AA18F02503151B0302020100000000000000360000001DBB'],
]

// The washer paused, with a delay waiting. First the downloaded Sweat Stain, which had been
// started with a six hour delay; then Cotton, a dial course, started by the LG app with three.
// Each was followed by the LG app's "cancel delay", which restarted the cycle at once.
const PAUSED_DOWNLOADED_STATUS = buf(
    'aa5420ec002504040304030100030506020006000042210001013b27003b00000500000000000000000000002502040304030100030506020006000042010004043b27003b00000500000000000000000000cdbb',
)
const PAUSED_DIAL_STATUS = buf(
    'aa5420ec002504033a033a0100030a04010003000042210001010027003b00000000000000000000000000002502033a033a0100030a04010003000042010003040027003b00000400000000000000000000a4bb',
)
const CANCEL_DELAY_DOWNLOADED = 'AA16F0260103050602000000000002003B00000071BB'
const CANCEL_DELAY_DIAL = 'AA16F02601030A04010000000000020000000000BEBB'

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

        test('right after a wake, a download needs every setting chosen first', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', WOKEN_STATUS)
            thinq.resetRecorder()

            dev.setProperty('download_programme', '')
            dev.setProperty('set_spin', '800 rpm')
            dev.setProperty('set_temp', '60 °C')
            dev.setProperty('download_programme', '')
            assert.equal(thinq.outbox.length, 0)

            dev.setProperty('set_soil', 'Intensive')
            dev.setProperty('set_rinse', 'Rinse+')
            dev.setProperty('download_programme', '')
            assert.equal(lastSent(thinq), DOWNLOAD_SOIL_INTENSIVE)
        })

        test('nothing is downloaded while the slot is empty', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', EMPTY_SLOT_STATUS)
            thinq.resetRecorder()
            dev.setProperty('set_soil', 'Intensive')
            dev.setProperty('set_spin', '800 rpm')
            dev.setProperty('set_temp', '60 °C')
            dev.setProperty('set_rinse', 'Rinse+')
            dev.setProperty('download_programme', '')
            assert.equal(thinq.outbox.length, 0)
        })

        test('the 1400 rpm the washer reports for Max is offered back and sent as it was set', () => {
            const { ha, thinq, dev } = makeDevice()
            thinq.emit('data', SPIN_1400_STATUS)
            assert.equal(ha.devices[DEVICE_ID].properties.spin, '1400 rpm')
            assert.equal(ha.devices[DEVICE_ID].properties.set_spin, '1400 rpm')

            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            thinq.resetRecorder()
            dev.setProperty('set_spin', '1400 rpm')
            dev.setProperty('download_programme', '')
            assert.equal(lastSent(thinq), DOWNLOAD_SPIN_1400)
        })

        test('every programme downloads as it was downloaded to the unit', () => {
            const { thinq, dev } = makeDevice()
            assert.equal(PROGRAMME_DOWNLOADS.length, 26)
            for (const [name, packet] of PROGRAMME_DOWNLOADS) {
                thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
                thinq.resetRecorder()
                dev.setProperty('set_smart_course', name)
                dev.setProperty('download_programme', '')
                assert.equal(lastSent(thinq), packet, name)
            }
        })

        test('the downloaded course is read back by name, selected or not', () => {
            const { ha, thinq } = makeDevice()
            thinq.emit('data', BABY_CARE_STATUS)
            assert.equal(ha.devices[DEVICE_ID].properties.smart_course, 'Baby Care')
            assert.equal(ha.devices[DEVICE_ID].properties.set_smart_course, 'Baby Care')

            thinq.emit('data', WOKEN_STATUS) // nothing selected, the slot still holds Sweat Stain
            assert.equal(ha.devices[DEVICE_ID].properties.smart_course, 'Sweat Stain')

            thinq.emit('data', EMPTY_SLOT_STATUS)
            assert.equal(ha.devices[DEVICE_ID].properties.smart_course, 'None')
        })

        test('choosing a course stages its settings, and a later choice overrides one of them', () => {
            const { ha, thinq, dev } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            dev.setProperty('set_smart_course', 'Baby Care') // 1000 rpm, 60 °C, Rinse+, pre-wash
            assert.equal(ha.devices[DEVICE_ID].properties.set_spin, '1000 rpm')
            assert.equal(ha.devices[DEVICE_ID].properties.set_prewash, 'ON')

            dev.setProperty('set_spin', '800 rpm')
            thinq.resetRecorder()
            dev.setProperty('download_programme', '')
            const sent = thinq.outbox[thinq.outbox.length - 1]
            assert.equal(sent[8], 0x05, 'the spin chosen after the course')
            assert.equal(sent[6], 0x01, 'Baby Care sits on Cotton')
            assert.equal(sent[18], 0x47, 'and has its own ID')
        })

        test('nothing runs while a chosen course has not been downloaded', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            dev.setProperty('set_smart_course', 'Baby Care')
            thinq.resetRecorder()
            dev.setProperty('run_programme', '')
            assert.equal(thinq.outbox.length, 0)
        })

        test('a delay stays staged when the course in the slot changes', () => {
            const { ha, thinq, dev } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN)
            dev.setProperty('set_delay_end', '3')
            dev.setProperty('set_smart_course', 'Baby Care')
            dev.setProperty('download_programme', '')

            thinq.emit('data', BABY_CARE_STATUS)
            assert.equal(ha.devices[DEVICE_ID].properties.set_delay_end, 3)
            assert.equal(ha.devices[DEVICE_ID].properties.set_smart_course, 'Baby Care')
        })

        test('a woken appliance takes a course chosen for it, whatever its base course', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', WOKEN_STATUS)
            thinq.resetRecorder()
            dev.setProperty('set_smart_course', 'Drain') // soil, temperature and rinse are all 0 for it
            dev.setProperty('download_programme', '')
            assert.equal(lastSent(thinq), PROGRAMME_DOWNLOADS.find(([name]) => name === 'Drain')![1])
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

        test('nothing runs before a programme has been selected', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', WOKEN_STATUS)
            thinq.resetRecorder()
            dev.setProperty('set_soil', 'Intensive')
            dev.setProperty('set_spin', '800 rpm')
            dev.setProperty('set_temp', '60 °C')
            dev.setProperty('set_rinse', 'Rinse+')
            dev.setProperty('run_programme', '')
            assert.equal(thinq.outbox.length, 0)
        })

        test('a paused cycle is sent what the LG app sends to cancel its delay', () => {
            const { thinq, dev } = makeDevice()
            for (const [status, packet] of [
                [PAUSED_DOWNLOADED_STATUS, CANCEL_DELAY_DOWNLOADED],
                [PAUSED_DIAL_STATUS, CANCEL_DELAY_DIAL],
            ] as const) {
                thinq.emit('data', status)
                thinq.resetRecorder()
                dev.setProperty('cancel_delay', '')
                assert.equal(lastSent(thinq), packet)
            }
        })

        test('cancelling a delay sends what is reported, not what is staged', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', PAUSED_DIAL_STATUS)
            dev.setProperty('set_spin', '800 rpm')
            dev.setProperty('set_delay_end', '5')
            thinq.resetRecorder()
            dev.setProperty('cancel_delay', '')
            assert.equal(lastSent(thinq), CANCEL_DELAY_DIAL)
        })

        test('there is nothing to cancel, so nothing is sent, when no delay is waiting', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', DOWNLOADED_SWEAT_STAIN) // standby: sending would start a wash
            thinq.resetRecorder()
            dev.setProperty('cancel_delay', '')
            assert.equal(thinq.outbox.length, 0)
        })

        test('a paused cycle is sent the resume flags, with the delay that was staged', () => {
            const { thinq, dev } = makeDevice()
            thinq.emit('data', PAUSED_DIAL_STATUS)
            thinq.resetRecorder()
            dev.setProperty('set_delay_end', '0')
            dev.setProperty('run_programme', '')
            assert.equal(lastSent(thinq), CANCEL_DELAY_DIAL)

            thinq.emit('data', PAUSED_DIAL_STATUS)
            dev.setProperty('set_delay_end', '5')
            dev.setProperty('run_programme', '')
            const sent = thinq.outbox[thinq.outbox.length - 1]
            assert.equal(sent[10], 5, 'the new delay')
            assert.equal(sent[14], 0x02, 'resume flags, not the 0x03 of a start')
        })
    })
})
