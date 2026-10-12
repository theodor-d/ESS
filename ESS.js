const MAX30102_ADDR = 0x57
const REG_MODE_CONFIG = 0x09
const REG_FIFO_CONFIG = 0x08
const REG_SPO2_CONFIG = 0x0A
const REG_LED1_PA = 0x0C
const REG_LED2_PA = 0x0D
const REG_FIFO_WR_PTR = 0x04
const REG_OVF_COUNTER = 0x05
const REG_FIFO_RD_PTR = 0x06
const REG_FIFO_DATA = 0x07

const SAMPLE_INTERVAL_MS = 40
const WINDOW_SECONDS = 8
const WINDOW_SAMPLES = Math.idiv(WINDOW_SECONDS * 1000, SAMPLE_INTERVAL_MS)

function writeReg(reg: number, value: number): void {
    let buf = pins.createBuffer(2)
    buf.setNumber(NumberFormat.UInt8LE, 0, reg)
    buf.setNumber(NumberFormat.UInt8LE, 1, value)
    pins.i2cWriteBuffer(MAX30102_ADDR, buf)
}

function readReg(reg: number, length: number): Buffer {
    let regBuf = pins.createBuffer(1)
    regBuf.setNumber(NumberFormat.UInt8LE, 0, reg)
    pins.i2cWriteBuffer(MAX30102_ADDR, regBuf, true)
    return pins.i2cReadBuffer(MAX30102_ADDR, length)
}

function max30102Init(): void {
    writeReg(REG_MODE_CONFIG, 0x40)
    basic.pause(100)
    writeReg(REG_FIFO_CONFIG, 0x4F)
    writeReg(REG_MODE_CONFIG, 0x03)
    writeReg(REG_SPO2_CONFIG, 0x27)
    writeReg(REG_LED1_PA, 0x24)
    writeReg(REG_LED2_PA, 0x24)
    writeReg(REG_FIFO_WR_PTR, 0x00)
    writeReg(REG_OVF_COUNTER, 0x00)
    writeReg(REG_FIFO_RD_PTR, 0x00)
}

function readFifoSample(): number[] {
    let data = readReg(REG_FIFO_DATA, 6)
    let red = ((data.getNumber(NumberFormat.UInt8LE, 0) & 0x03) << 16) |
        (data.getNumber(NumberFormat.UInt8LE, 1) << 8) |
        data.getNumber(NumberFormat.UInt8LE, 2)
    let ir = ((data.getNumber(NumberFormat.UInt8LE, 3) & 0x03) << 16) |
        (data.getNumber(NumberFormat.UInt8LE, 4) << 8) |
        data.getNumber(NumberFormat.UInt8LE, 5)
    return [red, ir]
}

function computeHrAndHrv(samples: number[]): number[] {
    if (samples.length < 10) return [0, 0]
    let smoothed: number[] = []
    let windowSize = 4
    for (let i = 0; i < samples.length; i++) {
        let start = Math.max(0, i - windowSize)
        let sum = 0
        let count = 0
        for (let j = start; j <= i; j++) {
            sum += samples[j]
            count += 1
        }
        smoothed.push(sum / count)
    }
    let mean = 0
    for (let v of smoothed) mean += v
    mean = mean / smoothed.length

    let peakIndices: number[] = []
    let minDistanceSamples = Math.idiv(300, SAMPLE_INTERVAL_MS)
    let lastPeak = -minDistanceSamples
    for (let i = 1; i < smoothed.length - 1; i++) {
        if (smoothed[i] > mean && smoothed[i] > smoothed[i - 1] && smoothed[i] >= smoothed[i + 1]) {
            if (i - lastPeak >= minDistanceSamples) {
                peakIndices.push(i)
                lastPeak = i
            }
        }
    }
    if (peakIndices.length < 2) return [0, 0]

    let intervalsMs: number[] = []
    for (let i = 1; i < peakIndices.length; i++) {
        intervalsMs.push((peakIndices[i] - peakIndices[i - 1]) * SAMPLE_INTERVAL_MS)
    }
    let avgIntervalMs = 0
    for (let v of intervalsMs) avgIntervalMs += v
    avgIntervalMs = avgIntervalMs / intervalsMs.length
    let hr = avgIntervalMs > 0 ? 60000 / avgIntervalMs : 0

    let variance = 0
    for (let v of intervalsMs) variance += (v - avgIntervalMs) * (v - avgIntervalMs)
    variance = variance / intervalsMs.length
    let hrv = Math.sqrt(variance)

    return [Math.round(hr), Math.round(hrv)]
}

function computeMovementLevel(accelSamples: number[]): number {
    if (accelSamples.length == 0) return 0
    let sumSq = 0
    for (let v of accelSamples) {
        let dev = v - 1000
        sumSq += dev * dev
    }
    return Math.round(Math.sqrt(sumSq / accelSamples.length))
}

max30102Init()
basic.showIcon(IconNames.SmallDiamond)
basic.pause(500)
basic.clearScreen()

basic.forever(function () {
    let irBuffer: number[] = []
    let accelBuffer: number[] = []

    for (let i = 0; i < WINDOW_SAMPLES; i++) {
        let sample = readFifoSample()
        irBuffer.push(sample[1])
        accelBuffer.push(input.acceleration(Dimension.Strength))
        basic.pause(SAMPLE_INTERVAL_MS)
    }

    let hrHrv = computeHrAndHrv(irBuffer)
    let hr = hrHrv[0]
    let hrv = hrHrv[1]
    let movement = computeMovementLevel(accelBuffer)

    serial.writeLine(hr + "," + hrv + "," + movement)
})
