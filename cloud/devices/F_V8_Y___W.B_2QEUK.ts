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
// LG declares it.
const SETTABLE_TEMPERATURES = Enum.of({ Cold: 1, '20 °C': 2, '30 °C': 3, '40 °C': 4, '60 °C': 6, '95 °C': 7 })
const SETTABLE_SPINS = Enum.of({ 'No spin': 1, '400 rpm': 2, '800 rpm': 5, '1000 rpm': 7, Max: 255 })
const SETTABLE_RINSES = Enum.of({ Normal: 1, 'Rinse+': 2, 'Rinse++': 3, 'Normal + Hold': 4, 'Rinse+ + Hold': 5 })
const SETTABLE_SOILS = Enum.of({ TurboWash: 1, 'Time save': 2, Normal: 3, Intensive: 4 })

// Bit positions in the options byte, both in a programme record and in the status block.
const OPTION_BITS: Record<string, number> = {
    turbowash: 0x01,
    prewash: 0x40,
    steam: 0x80,
}

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

        // buf[22] is the downloaded programme actually selected, buf[25] the one in the download slot.
        // Choices staged for one programme mean nothing for another, so a different programme being
        // selected, or loaded into the slot, drops them.
        const previous = this.reported
        if (previous && (previous.course !== course || previous.selected !== buf[22] || previous.slot !== buf[25])) {
            this.pending.clear()
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
        for (const [name, bit] of Object.entries(OPTION_BITS)) {
            this.publishProperty(`set_${name}`, (options ?? 0) & bit ? 'ON' : 'OFF')
        }
    }

    /**
     * The last report, if the downloaded programme is the one the appliance has selected. Both
     * commands below describe that programme: the course byte is the base of whatever is selected,
     * and pairing it with a different programme's ID is unconfirmed.
     */
    private downloaded(what: string) {
        const r = this.reported
        if (r === undefined || r.selected === 0 || r.selected !== r.slot) {
            this.log(`ignoring ${what}, the downloaded programme is not the selected one`)
            return undefined
        }
        return r
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
        const r = this.downloaded('download')
        if (r === undefined) return undefined
        return Buffer.from([
            0xf0,
            0x25,
            0x03,
            0x15,
            r.course,
            this.setting('soil')!,
            this.setting('spin')!,
            this.setting('temp')!,
            this.setting('rinse')!,
            0, // dryLevel
            0, // reserveTimeHour
            0, // reserveTimeMinute
            0, // loadItemWasher
            this.setting('options')!,
            0, // flags
            0,
            r.slot,
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
        const r = this.downloaded('run')
        if (r === undefined) return undefined
        return Buffer.from([
            0xf0,
            0x26,
            r.course,
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
            r.selected,
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
            if (command) this.send(command)
            // The appliance is the authority on what it holds now; drop the choices so the entities
            // follow it again, which also shows a download it refused. A delay is not part of a
            // download, so it stays for the run.
            for (const setting of ['soil', 'spin', 'temp', 'rinse', 'options']) this.pending.delete(setting)
            this.publishSettings()
            return
        }

        if (prop === 'run_programme') {
            const command = this.programmeCommand()
            if (command) this.send(command)
            // As above, with the delay used up as well.
            this.pending.clear()
            this.publishSettings()
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
