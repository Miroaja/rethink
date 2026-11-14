import HADevice from './base'
import { Device as Thinq2Device } from '../thinq2/device'
import { tombstone, type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import AABBDevice from './aabb_device'
import { ERRORS, COURSES, TEMPERATURES, SPINS, SOIL_LEVELS, RINSES } from './washer_common'
import { Enum } from '@/util/enum'

// Codes derived from modelJSON & observation of the LG app.
const STATUS = Enum.of({
    Off: 0,
    Standby: 1,
    Paused: 2,
    Delayed: 3,
    Detecting: 4,
    Washing: 6,
    Rinsing: 7,
    Spinning: 8,
    Drying: 9,
    End: 10,
    'Cool down': 11,
    'Rinse hold': 12,
    Refreshing: 14,
    'Steam softening': 15,
    // the app shows the first one as a wash state, the second as a sub-state of Completed
    Demo: 16,
    Error: 18,
})

// What the Cotton course (the base of the downloadable programmes seen so far) offers in this
// model's modelJson, under the labels the sensors above already use. 800 rpm, Max, 40 and 60 °C
// were confirmed on a unit, as was every rinse and soil level below, although the modelJson
// lists only Normal and Rinse+ for the rinse and no choice at all for the soil. The rest is as
// LG declares it. Max is sent as 255 and read back as 1400 rpm, the machine's top speed.
const SETTABLE_TEMPERATURES = Enum.of({ Cold: 1, '20 °C': 2, '30 °C': 3, '40 °C': 4, '60 °C': 6, '95 °C': 7 })
const SETTABLE_SPINS = Enum.of({
    'No spin': 1,
    '400 rpm': 2,
    '800 rpm': 5,
    '1000 rpm': 7,
    '1200 rpm': 9,
    '1400 rpm': 10,
    Max: 255,
})
const SETTABLE_RINSES = Enum.of({ Normal: 1, 'Rinse+': 2, 'Rinse++': 3, 'Normal + Hold': 4, 'Rinse+ + Hold': 5 })
const SETTABLE_SOILS = Enum.of({ TurboWash: 1, 'Time save': 2, Normal: 3, Intensive: 4 })

// Bit positions in the options byte, both in a programme record and in the status block.
const OPTION_BITS: Record<string, number> = {
    turbowash: 0x01,
    prewash: 0x40,
    steam: 0x80,
}

// The programmes the LG app can download into this model's slot, under the names and IDs of the
// shared SMART_COURSES table. Each was downloaded to a unit, its ID read back from the status block
// and the name the LG app showed for it noted: all 26 agreed with the table. The settings are the
// defaults modelJson gives each programme, and the base course is the one it names. The base
// courses off Cotton are the sibling Y_V8_Y___W.B32QEUK's; the washer took them as sent and its
// time estimates followed them, from 14 minutes for Single Garment to a minute for Drain.
const PROGRAMMES = [
    { name: 'Baby Care', id: 0x47, course: 0x01, soil: 3, spin: 7, temp: 6, rinse: 2, options: 0x50 },
    { name: 'Blanket', id: 0x3a, course: 0x05, soil: 3, spin: 2, temp: 1, rinse: 1, options: 0x00 },
    { name: 'Cold Wash', id: 0x4d, course: 0x01, soil: 3, spin: 255, temp: 1, rinse: 1, options: 0x00 },
    { name: 'Colour Protection', id: 0x3f, course: 0x20, soil: 3, spin: 5, temp: 2, rinse: 1, options: 0x00 },
    { name: 'Drain', id: 0x79, course: 0x17, soil: 0, spin: 1, temp: 0, rinse: 0, options: 0x00 },
    { name: 'Gym Clothes', id: 0x38, course: 0x08, soil: 3, spin: 5, temp: 1, rinse: 1, options: 0x00 },
    { name: 'Hygiene', id: 0x48, course: 0x2d, soil: 3, spin: 255, temp: 6, rinse: 1, options: 0x80 },
    { name: 'Jeans', id: 0x39, course: 0x20, soil: 3, spin: 255, temp: 2, rinse: 1, options: 0x00 },
    { name: 'Juice and Food Stains', id: 0x6c, course: 0x01, soil: 3, spin: 7, temp: 4, rinse: 1, options: 0x40 },
    { name: 'Kids Wear', id: 0x34, course: 0x01, soil: 3, spin: 9, temp: 6, rinse: 1, options: 0x40 },
    { name: 'Lightly Soiled Items', id: 0x65, course: 0x1b, soil: 3, spin: 2, temp: 2, rinse: 1, options: 0x00 },
    { name: 'Lingerie', id: 0x4a, course: 0x20, soil: 3, spin: 5, temp: 2, rinse: 1, options: 0x00 },
    {
        name: 'Minimize Detergent Residue',
        id: 0x66,
        course: 0x01,
        soil: 3,
        spin: 255,
        temp: 4,
        rinse: 2,
        options: 0x00,
    },
    { name: 'Minimize Wrinkles', id: 0x6f, course: 0x01, soil: 3, spin: 255, temp: 4, rinse: 1, options: 0x00 },
    { name: 'Noise Minimize', id: 0x40, course: 0x09, soil: 3, spin: 7, temp: 4, rinse: 1, options: 0x00 },
    { name: 'Quick Tub Clean', id: 0x71, course: 0x30, soil: 3, spin: 2, temp: 1, rinse: 0, options: 0x00 },
    { name: 'Rainy Season', id: 0x37, course: 0x01, soil: 3, spin: 255, temp: 4, rinse: 1, options: 0x00 },
    { name: 'Rinse + Spin', id: 0x64, course: 0x0e, soil: 3, spin: 255, temp: 0, rinse: 1, options: 0x00 },
    { name: 'School Uniform', id: 0x35, course: 0x02, soil: 3, spin: 7, temp: 4, rinse: 1, options: 0x00 },
    { name: 'Single Garment', id: 0x3e, course: 0x0c, soil: 3, spin: 2, temp: 2, rinse: 1, options: 0x01 },
    { name: 'Skin Care', id: 0x4c, course: 0x01, soil: 3, spin: 255, temp: 4, rinse: 2, options: 0x10 },
    { name: 'Sleeve Hems and Collars', id: 0x6b, course: 0x01, soil: 3, spin: 7, temp: 6, rinse: 1, options: 0x40 },
    { name: 'Small Load', id: 0x49, course: 0x0c, soil: 3, spin: 2, temp: 2, rinse: 1, options: 0x01 },
    { name: 'Spin', id: 0x7a, course: 0x17, soil: 0, spin: 255, temp: 0, rinse: 0, options: 0x00 },
    { name: 'Sweat Stain', id: 0x3b, course: 0x01, soil: 3, spin: 255, temp: 4, rinse: 1, options: 0x00 },
    { name: 'Swimming Wear', id: 0x36, course: 0x1b, soil: 3, spin: 2, temp: 2, rinse: 1, options: 0x00 },
]
const PROGRAMME_NAMES = new Enum<string>(PROGRAMMES.map((p) => [p.name, p.id]))
const PROGRAMME_BY_ID = new Map(PROGRAMMES.map((p) => [p.id, p]))
const PROGRAMME_BY_NAME = new Map(PROGRAMMES.map((p) => [p.name, p]))

export default class Device extends AABBDevice {
    // F025 downloads a programme into the appliance's single download slot and F026 runs one. Both
    // carry every setting at once, so the choices made through the set_* entities are held here
    // until a button is pressed, each defaulting to what the appliance last reported.
    private pending = new Map<string, number>()
    private reported?: {
        course: number
        soil: number
        spin: number
        temp: number
        rinse: number
        options: number
        delay_end: number
        selected: number
        slot: number
    }

    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq, false)
        this.setConfig(
            allowExtendedType({
                ...HADevice.config(meta, { name: 'LG Washer' }),
                components: {
                    power: {
                        platform: 'switch',
                        unique_id: '$deviceid-power',
                        state_topic: '$this/power',
                        command_topic: '$this/power/set',
                        name: '',
                        icon: 'mdi:washing-machine',
                    },
                    start: {
                        platform: 'button',
                        unique_id: '$deviceid-start',
                        command_topic: '$this/start/set',
                        payload_press: '',
                        name: 'Start',
                        icon: 'mdi:play-circle-outline',
                    },
                    pause: {
                        platform: 'button',
                        unique_id: '$deviceid-pause',
                        command_topic: '$this/pause/set',
                        payload_press: '',
                        name: 'Pause',
                        icon: 'mdi:pause-circle-outline',
                    },
                    status: {
                        platform: 'sensor',
                        unique_id: '$deviceid-status',
                        state_topic: '$this/status',
                        name: 'Status',
                        icon: 'mdi:state-machine',
                        device_class: 'enum',
                        options: STATUS.options,
                    },
                    error: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-error',
                        state_topic: '$this/error',
                        name: 'Error',
                        icon: 'mdi:check-circle',
                        device_class: 'problem',
                        entity_category: 'diagnostic',
                    },
                    error_message: {
                        platform: 'sensor',
                        unique_id: '$deviceid-error-message',
                        state_topic: '$this/error_message',
                        name: 'Error message',
                        icon: 'mdi:alert-circle-outline',
                        device_class: 'enum',
                        entity_category: 'diagnostic',
                        options: ERRORS.options,
                    },
                    course: {
                        platform: 'sensor',
                        unique_id: '$deviceid-course',
                        state_topic: '$this/course',
                        name: 'Course',
                        icon: 'mdi:pin-outline',
                    },
                    temp: {
                        platform: 'sensor',
                        unique_id: '$deviceid-temp',
                        state_topic: '$this/temp',
                        name: 'Temperature',
                        device_class: 'enum',
                        options: TEMPERATURES.options,
                    },
                    spin: {
                        platform: 'sensor',
                        unique_id: '$deviceid-spin',
                        state_topic: '$this/spin',
                        name: 'Spin',
                        icon: 'mdi:autorenew',
                        device_class: 'enum',
                        options: SPINS.options,
                    },
                    rinse: {
                        platform: 'sensor',
                        unique_id: '$deviceid-rinse',
                        state_topic: '$this/rinse',
                        name: 'Rinse',
                        icon: 'mdi:water',
                        device_class: 'enum',
                        options: RINSES.options,
                    },
                    cycles: {
                        platform: 'sensor',
                        unique_id: '$deviceid-cycles',
                        state_topic: '$this/cycles',
                        name: 'Cycle count',
                        icon: 'mdi:counter',
                    },
                    remote_start: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-remote_start',
                        state_topic: '$this/remote_start',
                        name: 'Remote start',
                        icon: 'mdi:play-circle-outline',
                    },
                    door_lock: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-door_lock',
                        state_topic: '$this/door_lock',
                        name: 'Door lock',
                        device_class: 'lock',
                    },
                    child_lock: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-child_lock',
                        state_topic: '$this/child_lock',
                        name: 'Child lock',
                        device_class: 'lock',
                    },
                    energy: {
                        platform: 'sensor',
                        unique_id: '$deviceid-energy',
                        state_topic: '$this/energy',
                        name: 'Energy',
                        icon: 'mdi:lightning-bolt',
                        device_class: 'energy',
                        state_class: 'total_increasing',
                        unit_of_measurement: 'Wh',
                    },
                    initial_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-initial_time',
                        state_topic: '$this/initial_time',
                        device_class: 'duration',
                        unit_of_measurement: 'min',
                        name: 'Initial time',
                    },
                    remaining_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-remaining_time',
                        state_topic: '$this/remaining_time',
                        device_class: 'duration',
                        unit_of_measurement: 'min',
                        name: 'Remaining time',
                    },
                    reserve_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-reserve_time',
                        state_topic: '$this/reserve_time',
                        device_class: 'duration',
                        unit_of_measurement: 'min',
                        name: 'Reserve time',
                        icon: 'mdi:timer-sand',
                    },
                    extra_rinse: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-extra_rinse',
                        state_topic: '$this/extra_rinse',
                        name: 'Extra rinse',
                        icon: 'mdi:water-plus',
                    },
                    turbowash: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-turbowash',
                        state_topic: '$this/turbowash',
                        name: 'TurboWash',
                        icon: 'mdi:rocket-launch',
                    },
                    prewash: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-prewash',
                        state_topic: '$this/prewash',
                        name: 'Pre-wash',
                        icon: 'mdi:water-sync',
                    },
                    soil: {
                        platform: 'sensor',
                        unique_id: '$deviceid-soil',
                        state_topic: '$this/soil',
                        name: 'Soil level',
                        icon: 'mdi:washing-machine',
                        device_class: 'enum',
                        options: SOIL_LEVELS.options,
                    },
                    intensive_wash: tombstone('binary_sensor'),
                    steam: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-steam',
                        state_topic: '$this/steam',
                        name: 'Steam',
                        icon: 'mdi:kettle-steam',
                    },
                    set_temp: {
                        platform: 'select',
                        unique_id: '$deviceid-set_temp',
                        state_topic: '$this/set_temp',
                        command_topic: '$this/set_temp/set',
                        name: 'Set temperature',
                        icon: 'mdi:thermometer',
                        options: SETTABLE_TEMPERATURES.options,
                    },
                    set_spin: {
                        platform: 'select',
                        unique_id: '$deviceid-set_spin',
                        state_topic: '$this/set_spin',
                        command_topic: '$this/set_spin/set',
                        name: 'Set spin',
                        icon: 'mdi:autorenew',
                        options: SETTABLE_SPINS.options,
                    },
                    set_rinse: {
                        platform: 'select',
                        unique_id: '$deviceid-set_rinse',
                        state_topic: '$this/set_rinse',
                        command_topic: '$this/set_rinse/set',
                        name: 'Set rinse',
                        icon: 'mdi:water',
                        options: SETTABLE_RINSES.options,
                    },
                    smart_course: {
                        platform: 'sensor',
                        unique_id: '$deviceid-smart_course',
                        state_topic: '$this/smart_course',
                        name: 'Downloaded course',
                        icon: 'mdi:cloud-download-outline',
                        device_class: 'enum',
                        options: PROGRAMME_NAMES.options,
                    },
                    set_smart_course: {
                        platform: 'select',
                        unique_id: '$deviceid-set_smart_course',
                        state_topic: '$this/set_smart_course',
                        command_topic: '$this/set_smart_course/set',
                        name: 'Set downloaded course',
                        icon: 'mdi:tune-vertical',
                        options: PROGRAMME_NAMES.options,
                    },
                    set_soil: {
                        platform: 'select',
                        unique_id: '$deviceid-set_soil',
                        state_topic: '$this/set_soil',
                        command_topic: '$this/set_soil/set',
                        name: 'Set soil level',
                        icon: 'mdi:washing-machine',
                        options: SETTABLE_SOILS.options,
                    },
                    set_steam: {
                        platform: 'switch',
                        unique_id: '$deviceid-set_steam',
                        state_topic: '$this/set_steam',
                        command_topic: '$this/set_steam/set',
                        name: 'Set steam',
                        icon: 'mdi:kettle-steam',
                    },
                    set_prewash: {
                        platform: 'switch',
                        unique_id: '$deviceid-set_prewash',
                        state_topic: '$this/set_prewash',
                        command_topic: '$this/set_prewash/set',
                        name: 'Set pre-wash',
                        icon: 'mdi:water-sync',
                    },
                    set_turbowash: {
                        platform: 'switch',
                        unique_id: '$deviceid-set_turbowash',
                        state_topic: '$this/set_turbowash',
                        command_topic: '$this/set_turbowash/set',
                        name: 'Set TurboWash',
                        icon: 'mdi:rocket-launch',
                    },
                    set_delay_end: {
                        platform: 'number',
                        unique_id: '$deviceid-set_delay_end',
                        state_topic: '$this/set_delay_end',
                        command_topic: '$this/set_delay_end/set',
                        name: 'Set delayed end',
                        icon: 'mdi:timer-sand',
                        unit_of_measurement: 'h',
                        // 0 is off; the appliance accepts 3..19 per modelJson's reserveTimeHour.
                        min: 0,
                        max: 19,
                        step: 1,
                    },
                    download_programme: {
                        platform: 'button',
                        unique_id: '$deviceid-download_programme',
                        command_topic: '$this/download_programme/set',
                        payload_press: '',
                        name: 'Download programme',
                        icon: 'mdi:download-box-outline',
                    },
                    run_programme: {
                        platform: 'button',
                        unique_id: '$deviceid-run_programme',
                        command_topic: '$this/run_programme/set',
                        payload_press: '',
                        name: 'Run programme',
                        icon: 'mdi:play-box-outline',
                    },
                },
            }),
        )
    }

    start() {
        this.send(Buffer.from('F0ED1121010000001800', 'hex'))
    }

    processAABB(buf: Buffer) {
        this.processCommonStatus(buf, 0x20, 39, this.processStatus)
    }

    processStatus(buf: Buffer) {
        const status = buf[2]
        const time_remain = buf[3] * 60 + buf[4]
        const time_initial = buf[5] * 60 + buf[6]
        const course = buf[7]
        const error = buf[8]
        const soil = buf[9]
        const spin = buf[10]
        const temp = buf[11]
        const extra_rinse = buf[12]
        const time_reserve_hour = buf[14]
        const options = buf[16]
        const lock_status = buf[17]
        const cycles = buf[23]
        const energy = buf[30] * 256 + buf[31]

        this.publishProperty('power', status > 0 ? 'ON' : 'OFF')
        this.publishProperty('error_message', ERRORS.map(error)) // publish message before set error state
        this.publishProperty('error', error ? 'ON' : 'OFF')
        this.publishProperty('status', STATUS.map(status))
        this.publishProperty('course', COURSES.map(course))
        this.publishProperty('spin', SPINS.map(spin))
        this.publishProperty('temp', TEMPERATURES.map(temp))
        this.publishProperty('cycles', cycles)
        this.publishProperty('remote_start', lock_status & 2 ? 'ON' : 'OFF')
        this.publishProperty('door_lock', !(lock_status & 0x40) ? 'ON' : 'OFF') // inverted logic, off=locked
        this.publishProperty('child_lock', !(lock_status & 0x80) ? 'ON' : 'OFF') // inverted logic, off=locked
        this.publishProperty('initial_time', time_initial)
        this.publishProperty('remaining_time', time_remain)
        // buf[14] and buf[15] are the delay left as hours and minutes, counting down.
        this.publishProperty('reserve_time', time_reserve_hour * 60 + buf[15])
        this.publishProperty('energy', energy)
        this.publishProperty('extra_rinse', extra_rinse >= 2 ? 'ON' : 'OFF') // 0/1=off, 2+=one or more extra rinses (Rinse+)
        this.publishProperty('turbowash', options & 0x01 ? 'ON' : 'OFF')
        this.publishProperty('prewash', options & 0x40 ? 'ON' : 'OFF')
        this.publishProperty('steam', options & 0x80 ? 'ON' : 'OFF')
        this.publishProperty('soil', SOIL_LEVELS.map(soil))
        this.publishProperty('rinse', RINSES.map(extra_rinse))
        // buf[25] is the programme in the slot, which buf[22] shows only while it is selected.
        this.publishProperty('smart_course', PROGRAMME_NAMES.map(buf[25]))

        // buf[22] is the downloaded programme actually selected, buf[25] the one in the download slot.
        // Choices staged for one programme mean nothing for another, so a different programme being
        // selected, or loaded into the slot, drops them. A delay is a time, not a setting of the
        // programme, so it stays.
        const previous = this.reported
        if (previous && (previous.course !== course || previous.selected !== buf[22] || previous.slot !== buf[25])) {
            const delay = this.pending.get('delay_end')
            this.pending.clear()
            if (delay !== undefined) this.pending.set('delay_end', delay)
        }
        this.reported = {
            course,
            soil,
            spin,
            temp,
            rinse: extra_rinse,
            options,
            delay_end: time_reserve_hour,
            selected: buf[22],
            slot: buf[25],
        }
        this.publishSettings()
    }

    /** A setting's effective value: what the user chose, or failing that what the appliance reports. */
    private setting(prop: 'soil' | 'spin' | 'temp' | 'rinse' | 'options' | 'delay_end') {
        return this.pending.get(prop) ?? this.reported?.[prop]
    }

    /** Republish every set_* entity. Called on each status block and after each choice. */
    private publishSettings() {
        const soil = this.setting('soil')
        const temp = this.setting('temp')
        const spin = this.setting('spin')
        const rinse = this.setting('rinse')
        const options = this.setting('options')
        // Codes outside the selectable lists (an idle appliance reports 0) publish as 'None'.
        this.publishProperty('set_soil', soil === undefined ? undefined : SETTABLE_SOILS.map(soil))
        this.publishProperty('set_temp', temp === undefined ? undefined : SETTABLE_TEMPERATURES.map(temp))
        this.publishProperty('set_spin', spin === undefined ? undefined : SETTABLE_SPINS.map(spin))
        this.publishProperty('set_rinse', rinse === undefined ? undefined : SETTABLE_RINSES.map(rinse))
        this.publishProperty('set_delay_end', this.setting('delay_end'))
        const programme = this.pending.get('programme') ?? this.reported?.slot
        this.publishProperty('set_smart_course', programme === undefined ? undefined : PROGRAMME_NAMES.map(programme))
        for (const [name, bit] of Object.entries(OPTION_BITS)) {
            this.publishProperty(`set_${name}`, (options ?? 0) & bit ? 'ON' : 'OFF')
        }
    }

    /**
     * The course and ID to put in a record, if the downloaded programme is one the commands below
     * may describe. Normally that is the programme the appliance has selected, whose base course it
     * reports. A freshly woken appliance reports no course and no settings, and selects the
     * downloaded programme when one arrives; its base course then comes from the table above,
     * which is all `woken` lets through. Pairing a course with another programme's ID is
     * unconfirmed.
     */
    private downloaded(what: string, woken = false) {
        const r = this.reported
        if (r !== undefined && r.selected !== 0 && r.selected === r.slot) return { course: r.course, id: r.slot }
        const known =
            r !== undefined && woken && r.selected === 0 && r.course === 0 ? PROGRAMME_BY_ID.get(r.slot) : undefined
        if (known) return { course: known.course, id: known.id }
        this.log(`ignoring ${what}, the downloaded programme is not the selected one`)
        return undefined
    }

    /**
     * F0 25 03 15 <course> <soilWash> <spin> <temp> <rinse> <dryLevel> <reserveH> <reserveM>
     *             <loadItem> <options> <flags> 00 <smartCourse> 00 00 00
     *
     * The record after 03 15 is the one F026 carries to start a programme. Confirmed against a
     * download issued from the LG app (Sweat Stain, whose course, soilWash, spin, temp and rinse
     * bytes are modelJson's defaults for it), and by changing each setting from HA and reading
     * the status block back. 03 15 is the download type and the data length from modelJson's
     * WMDownload; the length is not the 16 bytes that follow, and is sent as the app sends it.
     *
     * dryLevel, the delay, loadItem and flags did nothing in a download and are sent as 0, as the
     * app does.
     */
    private downloadCommand() {
        // A programme chosen through set_smart_course brings its base course and its own settings.
        const chosen = PROGRAMME_BY_ID.get(this.pending.get('programme') ?? 0)
        const target = chosen ? { course: chosen.course, id: chosen.id } : this.downloaded('download', true)
        if (target === undefined) return undefined
        const soil = this.setting('soil') ?? 0
        const spin = this.setting('spin') ?? 0
        const temp = this.setting('temp') ?? 0
        const rinse = this.setting('rinse') ?? 0
        // 0 is what an appliance that has just woken reports for each of these: no choice made. A
        // chosen programme has zeros of its own, such as Drain's.
        if (!chosen && (!soil || !spin || !temp || !rinse)) {
            this.log('ignoring download, a setting is neither reported nor chosen')
            return undefined
        }
        return Buffer.from([
            0xf0,
            0x25,
            0x03,
            0x15,
            target.course,
            soil,
            spin,
            temp,
            rinse,
            0, // dryLevel
            0, // reserveTimeHour
            0, // reserveTimeMinute
            0, // loadItemWasher
            this.setting('options') ?? 0,
            0, // flags
            0,
            target.id,
            0,
            0,
            0,
        ])
    }

    /**
     * F0 26 <course> <soilWash> <spin> <temp> <rinse> <dryLevel> <reserveH> <reserveM> <loadItem>
     *       <options> <flags> 00 <smartCourse> 00 00 00
     *
     * The record F025 downloads, run. Confirmed with the downloaded Sweat Stain at 60 °C, 800 rpm
     * and Rinse+, delayed by three hours: the appliance acknowledged it, went to Delayed with the
     * delay left counting down in the status block, and took the rinse level from the packet over
     * the one it had held. Layout and flags as on the sibling Y_V8_Y___W.B32QEUK.
     *
     * 0x03 is initialBit | remoteStart, which the sibling sends with every start. Only the
     * downloaded programme has been seen running on this model, so that is all this runs.
     */
    private programmeCommand() {
        if (this.pending.has('programme')) {
            this.log('ignoring run, the chosen programme has not been downloaded')
            return undefined
        }
        const target = this.downloaded('run')
        if (target === undefined) return undefined
        return Buffer.from([
            0xf0,
            0x26,
            target.course,
            this.setting('soil')!,
            this.setting('spin')!,
            this.setting('temp')!,
            this.setting('rinse')!,
            0, // dryLevel
            this.setting('delay_end')!,
            0, // reserveTimeMinute: the panel only offers whole hours
            0, // loadItemWasher
            this.setting('options')!,
            0x03, // initialBit | remoteStart
            0,
            target.id,
            0,
            0,
            0,
        ])
    }

    setProperty(prop: string, mqttValue: string) {
        if (prop === 'power') {
            if (mqttValue === 'ON') {
                this.send(Buffer.from('F02A0100', 'hex'))
            } else if (mqttValue === 'OFF') {
                this.send(Buffer.from('F024010100', 'hex'))
            }
        }

        if (prop === 'pause') this.send(Buffer.from('F024040100', 'hex'))
        if (prop === 'start') this.send(Buffer.from('F024050100', 'hex'))

        if (prop === 'download_programme') {
            const command = this.downloadCommand()
            if (command) {
                this.send(command)
                // The appliance is the authority on what it holds now; drop the choices so the entities
                // follow it again, which also shows a download it ignored. A delay is not part of a
                // download, so it stays for the run. A refused download leaves everything staged.
                for (const setting of ['programme', 'soil', 'spin', 'temp', 'rinse', 'options'])
                    this.pending.delete(setting)
                this.publishSettings()
            }
            return
        }

        if (prop === 'run_programme') {
            const command = this.programmeCommand()
            if (command) {
                this.send(command)
                // As above, with the delay used up as well.
                this.pending.clear()
                this.publishSettings()
            }
            return
        }

        const selects: Record<string, [string, Enum<string>]> = {
            set_soil: ['soil', SETTABLE_SOILS],
            set_temp: ['temp', SETTABLE_TEMPERATURES],
            set_spin: ['spin', SETTABLE_SPINS],
            set_rinse: ['rinse', SETTABLE_RINSES],
        }
        if (prop in selects) {
            const [setting, table] = selects[prop]
            const code = table.unmap(mqttValue)
            if (code !== undefined) this.pending.set(setting, code)
            this.publishSettings()
            return
        }

        if (prop === 'set_smart_course') {
            const programme = PROGRAMME_BY_NAME.get(mqttValue)
            if (programme) {
                this.pending.set('programme', programme.id)
                for (const setting of ['soil', 'spin', 'temp', 'rinse', 'options'] as const) {
                    this.pending.set(setting, programme[setting])
                }
            }
            this.publishSettings()
            return
        }

        if (prop === 'set_delay_end') {
            const hours = Number(mqttValue)
            // modelJson allows 3..19; 0 is how the panel expresses "no delayed end".
            if (Number.isInteger(hours) && (hours === 0 || (hours >= 3 && hours <= 19))) {
                this.pending.set('delay_end', hours)
            }
            this.publishSettings()
            return
        }

        const bit = OPTION_BITS[prop.slice(4)]
        if (prop.startsWith('set_') && bit !== undefined) {
            const options = this.setting('options') ?? 0
            this.pending.set('options', mqttValue === 'ON' ? options | bit : options & ~bit)
            this.publishSettings()
        }
    }
}
