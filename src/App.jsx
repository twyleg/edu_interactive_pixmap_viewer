import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const NETPBM_MAGIC_SET = new Set(['P2', 'P3', 'P5', 'P6'])
const WHITESPACE_CODES = new Set([9, 10, 13, 32])

const normalizeSample = (value, maxVal) => {
  if (maxVal <= 0) {
    throw new Error('Max value must be greater than zero')
  }
  if (maxVal === 255) return value
  return Math.round((value / maxVal) * 255)
}

// Minimal Netpbm parser supporting P2/P3 (ASCII) and P5/P6 (binary) variants.
const parseNetpbm = (buffer) => {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 3) {
    throw new Error('File is too small to be a valid Netpbm image')
  }

  const magic = String.fromCharCode(bytes[0]) + String.fromCharCode(bytes[1])
  if (!NETPBM_MAGIC_SET.has(magic)) {
    return null
  }

  let index = 2
  const decoder = new TextDecoder('ascii')

  const skipWhitespaceAndComments = () => {
    while (index < bytes.length) {
      const code = bytes[index]
      if (WHITESPACE_CODES.has(code)) {
        index += 1
        continue
      }
      if (code === 35) {
        while (index < bytes.length && bytes[index] !== 10 && bytes[index] !== 13) {
          index += 1
        }
        continue
      }
      break
    }
  }

  const skipHeaderSeparator = () => {
    while (index < bytes.length) {
      const code = bytes[index]
      if (WHITESPACE_CODES.has(code)) {
        index += 1
        continue
      }
      if (code === 35) {
        let lookahead = index + 1
        let sawNewline = false
        let isComment = true
        while (lookahead < bytes.length) {
          const la = bytes[lookahead]
          if (la === 10 || la === 13) {
            sawNewline = true
            break
          }
          if (la !== 9 && (la < 32 || la > 126)) {
            isComment = false
            break
          }
          lookahead += 1
        }
        if (isComment && sawNewline) {
          index = lookahead + 1
          continue
        }
      }
      break
    }
  }

  const readToken = () => {
    skipWhitespaceAndComments()
    if (index >= bytes.length) return null
    const start = index
    while (index < bytes.length) {
      const code = bytes[index]
      if (WHITESPACE_CODES.has(code) || code === 35) break
      index += 1
    }
    return decoder.decode(bytes.subarray(start, index))
  }

  const widthToken = readToken()
  const heightToken = readToken()
  const maxValToken = readToken()
  if (!widthToken || !heightToken || !maxValToken) {
    throw new Error('Header is incomplete or malformed')
  }

  const width = Number.parseInt(widthToken, 10)
  const height = Number.parseInt(heightToken, 10)
  const headerMaxVal = Number.parseInt(maxValToken, 10)
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(headerMaxVal)) {
    throw new Error('Width, height, or max value is not a valid number')
  }
  if (headerMaxVal <= 0) {
    throw new Error('Max value must be greater than zero')
  }

  const isColor = magic === 'P3' || magic === 'P6'
  const channelCount = isColor ? 3 : 1
  const sampleCount = width * height * channelCount
  const samples = new Uint8ClampedArray(sampleCount)

  if (magic === 'P2' || magic === 'P3') {
    for (let i = 0; i < sampleCount; i += 1) {
      const token = readToken()
      if (token === null) {
        throw new Error('Unexpected end of file while reading pixel data')
      }
      const rawValue = Number.parseInt(token, 10)
      if (!Number.isFinite(rawValue)) {
        throw new Error('Encountered a non-numeric value in pixel data')
      }
      samples[i] = normalizeSample(rawValue, headerMaxVal)
    }
  } else {
    skipHeaderSeparator()
    const bytesPerSample = headerMaxVal > 255 ? 2 : 1
    const neededLength = sampleCount * bytesPerSample
    if (bytes.length - index < neededLength) {
      throw new Error('Pixel data is shorter than expected')
    }
    let readOffset = 0
    const pixelBytes = bytes.subarray(index, index + neededLength)
    for (let i = 0; i < sampleCount; i += 1) {
      let rawValue
      if (bytesPerSample === 1) {
        rawValue = pixelBytes[readOffset]
        readOffset += 1
      } else {
        rawValue = (pixelBytes[readOffset] << 8) + pixelBytes[readOffset + 1]
        readOffset += 2
      }
      samples[i] = normalizeSample(rawValue, headerMaxVal)
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, sampleIndex = 0; i < width * height; i += 1) {
    const base = i * 4
    if (isColor) {
      rgba[base] = samples[sampleIndex]
      rgba[base + 1] = samples[sampleIndex + 1]
      rgba[base + 2] = samples[sampleIndex + 2]
      sampleIndex += 3
    } else {
      const gray = samples[sampleIndex]
      rgba[base] = gray
      rgba[base + 1] = gray
      rgba[base + 2] = gray
      sampleIndex += 1
    }
    rgba[base + 3] = 255
  }

  return {
    format: magic,
    width,
    height,
    maxVal: 255,
    sourceMaxVal: headerMaxVal,
    data: rgba,
  }
}

const generateNetpbmText = ({ format, width, height, data, sourceMaxVal }) => {
  const isColor = format === 'P3' || format === 'P6'
  const asciiFormat = isColor ? 'P3' : 'P2'
  const lines = [`${asciiFormat}`]

  const sourceDescriptor = format === 'P5' || format === 'P6' ? 'binary Netpbm' : 'ASCII Netpbm'
  lines.push(`# Source format: ${format} (${sourceDescriptor})`)
  if (sourceMaxVal && sourceMaxVal !== 255) {
    lines.push(`# Original max value: ${sourceMaxVal} — normalized to 255 for display`)
  } else {
    lines.push(`# Max value: 255`)
  }

  lines.push(`${width} ${height}`)
  lines.push('255')

  const tokens = []
  const totalPixels = width * height
  for (let i = 0; i < totalPixels; i += 1) {
    const base = i * 4
    if (isColor) {
      tokens.push(String(data[base]))
      tokens.push(String(data[base + 1]))
      tokens.push(String(data[base + 2]))
    } else {
      tokens.push(String(data[base]))
    }
  }

  const chunkSize = isColor ? 12 : 20
  for (let i = 0; i < tokens.length; i += chunkSize) {
    lines.push(tokens.slice(i, i + chunkSize).join(' '))
  }

  return lines.join('\n')
}

const parseNetpbmText = (text) => {
  const encoder = new TextEncoder()
  const buffer = encoder.encode(text).buffer
  const parsed = parseNetpbm(buffer)
  if (!parsed) {
    throw new Error('Input is not a valid Netpbm file')
  }
  if (parsed.format !== 'P2' && parsed.format !== 'P3') {
    throw new Error(`Editable representation requires P2 or P3 format, received ${parsed.format}`)
  }
  return parsed
}

function App() {
  const [renderTarget, setRenderTarget] = useState(null)
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [pickedColor, setPickedColor] = useState(null)
  const [pickerError, setPickerError] = useState('')
  const [tooltip, setTooltip] = useState(null)
  const [netpbmText, setNetpbmText] = useState('')
  const [netpbmTextError, setNetpbmTextError] = useState('')
  const objectUrlRef = useRef(null)
  const canvasRef = useRef(null)
  const analysisCanvasRef = useRef(null)
  const stageRef = useRef(null)

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (renderTarget?.kind === 'netpbm' && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      if (!ctx) return
      const { width, height, data } = renderTarget
      const imageData = new ImageData(data, width, height)
      canvasRef.current.width = width
      canvasRef.current.height = height
      ctx.putImageData(imageData, 0, 0)
      if (analysisCanvasRef.current) {
        analysisCanvasRef.current.width = width
        analysisCanvasRef.current.height = height
        const analysisCtx = analysisCanvasRef.current.getContext('2d', { willReadFrequently: true })
        analysisCtx?.putImageData(imageData, 0, 0)
      }
    }
  }, [renderTarget])

  const resetObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  const handleFile = useCallback(
    async (file) => {
      if (!file) return
      setError('')
      setPickedColor(null)
      setPickerError('')
      setTooltip(null)
      setNetpbmTextError('')
      setNetpbmText('')
      try {
        const buffer = await file.arrayBuffer()
        let parsed
        try {
          parsed = parseNetpbm(buffer)
        } catch (parseError) {
          throw parseError
        }

        if (parsed) {
          resetObjectUrl()
          const asciiText = generateNetpbmText(parsed)
          setNetpbmText(asciiText)
          setNetpbmTextError('')
          setRenderTarget({
            kind: 'netpbm',
            name: file.name,
            format: parsed.format,
            width: parsed.width,
            height: parsed.height,
            data: parsed.data,
            maxVal: parsed.maxVal,
            sourceMaxVal: parsed.sourceMaxVal,
            size: file.size,
          })
          return
        }

        const objectUrl = URL.createObjectURL(file)
        resetObjectUrl()
        objectUrlRef.current = objectUrl
        setNetpbmText('')
        setNetpbmTextError('')
        setRenderTarget({
          kind: 'standard',
          name: file.name,
          url: objectUrl,
          width: undefined,
          height: undefined,
          size: file.size,
        })
      } catch (err) {
        resetObjectUrl()
        setRenderTarget(null)
        setError(err instanceof Error ? err.message : 'Failed to load image')
        setNetpbmText('')
        setNetpbmTextError('')
      }
    },
    [resetObjectUrl],
  )

  const onFilesSelected = useCallback(
    (event) => {
      const file = event.target.files?.[0]
      handleFile(file)
      event.target.value = ''
    },
    [handleFile],
  )

  const onDragOver = useCallback((event) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(true)
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const onDragEnter = useCallback((event) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback((event) => {
    event.preventDefault()
    event.stopPropagation()
    const nextTarget = event.relatedTarget
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return
    }
    setIsDragging(false)
  }, [])

  const onDrop = useCallback(
    (event) => {
      event.preventDefault()
      event.stopPropagation()
      setIsDragging(false)
      const file = event.dataTransfer?.files?.[0]
      handleFile(file)
    },
    [handleFile],
  )

  const prettyFileSize = (bytes) => {
    if (bytes == null) return ''
    if (bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB']
    let size = bytes / 1024
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex += 1
    }
    return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`
  }

  const clampTooltipPosition = useCallback((value, max) => {
    if (value < 8) return 8
    if (value > max - 8) return Math.max(8, max - 8)
    return value
  }, [])

  const handleStageMouseMove = useCallback(
    (event) => {
      if (!renderTarget) return
      if (renderTarget.kind === 'netpbm' && netpbmTextError) return
      if (event.target === stageRef.current) {
        setTooltip(null)
        setPickedColor(null)
      }
    },
    [renderTarget, netpbmTextError],
  )

  const handleStagePointerLeave = useCallback(() => {
    setTooltip(null)
    setPickedColor(null)
  }, [])

  const handleNetpbmPointerMove = useCallback(
    (event) => {
      if (!renderTarget || renderTarget.kind !== 'netpbm') return
      if (netpbmTextError) return
      const stageElement = stageRef.current
      if (!stageElement) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const stageRect = stageElement.getBoundingClientRect()
      const offsetX = event.clientX - rect.left
      const offsetY = event.clientY - rect.top
      const scaleX = renderTarget.width / rect.width
      const scaleY = renderTarget.height / rect.height
      const x = Math.min(renderTarget.width - 1, Math.max(0, Math.floor(offsetX * scaleX)))
      const y = Math.min(renderTarget.height - 1, Math.max(0, Math.floor(offsetY * scaleY)))
      const base = (y * renderTarget.width + x) * 4
      const r = renderTarget.data[base]
      const g = renderTarget.data[base + 1]
      const b = renderTarget.data[base + 2]
      const a = renderTarget.data[base + 3]
      setPickedColor({ r, g, b, a, x, y })
      setPickerError('')
      if (!stageRect.width || !stageRect.height) return
      setTooltip({
        left: clampTooltipPosition(event.clientX - stageRect.left, stageRect.width),
        top: clampTooltipPosition(event.clientY - stageRect.top, stageRect.height),
      })
    },
    [renderTarget, clampTooltipPosition, netpbmTextError],
  )

  const handleStandardImageMove = useCallback(
    (event) => {
      if (!renderTarget || renderTarget.kind !== 'standard') return
      const { width, height } = renderTarget
      if (!width || !height) return
      const stageElement = stageRef.current
      if (!stageElement) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const stageRect = stageElement.getBoundingClientRect()
      const offsetX = event.clientX - rect.left
      const offsetY = event.clientY - rect.top
      const scaleX = width / rect.width
      const scaleY = height / rect.height
      const x = Math.min(width - 1, Math.max(0, Math.floor(offsetX * scaleX)))
      const y = Math.min(height - 1, Math.max(0, Math.floor(offsetY * scaleY)))
      const analysisCanvas = analysisCanvasRef.current
      if (!analysisCanvas) return
      const ctx = analysisCanvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      try {
        const pixel = ctx.getImageData(x, y, 1, 1).data
        setPickedColor({ r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3], x, y })
        setPickerError('')
      } catch (samplingError) {
        setPickerError('Unable to sample color for this image')
        setTooltip(null)
        setPickedColor(null)
        return
      }
      if (!stageRect.width || !stageRect.height) return
      setTooltip({
        left: clampTooltipPosition(event.clientX - stageRect.left, stageRect.width),
        top: clampTooltipPosition(event.clientY - stageRect.top, stageRect.height),
      })
    },
    [renderTarget, clampTooltipPosition],
  )

  const onNetpbmTextChange = useCallback(
    (event) => {
      const value = event.target.value
      setNetpbmText(value)
      if (!value.trim()) {
        setNetpbmTextError('Netpbm text is empty')
        setTooltip(null)
        setPickedColor(null)
        return
      }
      try {
        const parsed = parseNetpbmText(value)
        setNetpbmTextError('')
        setRenderTarget((prev) => {
          if (!prev || prev.kind !== 'netpbm') return prev
          return {
            ...prev,
            format: parsed.format,
            width: parsed.width,
            height: parsed.height,
            data: parsed.data,
            maxVal: parsed.maxVal,
            sourceMaxVal: parsed.sourceMaxVal,
          }
        })
      } catch (parseError) {
        setNetpbmTextError(parseError instanceof Error ? parseError.message : 'Unable to parse Netpbm text')
        setTooltip(null)
        setPickedColor(null)
      }
    },
    [],
  )

  const stageStyle =
    renderTarget?.width && renderTarget?.height
      ? { aspectRatio: renderTarget.width / renderTarget.height }
      : { aspectRatio: 16 / 9 }

  const stageClassName = [
    'viewer__stage',
    renderTarget?.kind === 'netpbm' && netpbmTextError ? 'viewer__stage--error' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const pickedHex =
    pickedColor != null
      ? `#${[pickedColor.r, pickedColor.g, pickedColor.b]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()}`
      : ''

  return (
    <div className="app">
      <div className="hero">
        <h1>Online Image Viewer</h1>
        <p className="hero__tagline">
          Drop or browse to preview common image formats, including raw Netpbm files (.ppm and .pgm).
        </p>
      </div>

      <div
        className={`dropzone ${isDragging ? 'dropzone--active' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <span className="dropzone__headline">Drag &amp; drop your image here</span>
        <span className="dropzone__subtext">.png .jpg .gif .ppm .pgm and more</span>
      </div>

      <label className="file-picker">
        <input type="file" accept="image/*,.ppm,.pgm" onChange={onFilesSelected} />
        Browse files
      </label>

      {error && <div className="error">{error}</div>}

      {renderTarget && (
        <section className="viewer">
          <div className="meta">
            <span>{renderTarget.name}</span>
            {renderTarget.size !== undefined && <span>{prettyFileSize(renderTarget.size)}</span>}
            {renderTarget.kind === 'netpbm' && <span>Format: {renderTarget.format}</span>}
            {renderTarget.width && renderTarget.height && (
              <span>
                {renderTarget.width} × {renderTarget.height}
              </span>
            )}
          </div>
          <div
            ref={stageRef}
            className={stageClassName}
            style={stageStyle}
            onMouseMove={handleStageMouseMove}
            onMouseLeave={handleStagePointerLeave}
          >
            {renderTarget.kind === 'netpbm' ? (
              netpbmTextError ? (
                <div className="viewer__placeholder">
                  <span className="viewer__placeholder-title">Cannot render Netpbm preview</span>
                  <span className="viewer__placeholder-message">{netpbmTextError}</span>
                </div>
              ) : (
                <canvas ref={canvasRef} onMouseMove={handleNetpbmPointerMove} onMouseLeave={handleStagePointerLeave} />
              )
            ) : (
              <img
                src={renderTarget.url}
                alt={renderTarget.name}
                onMouseLeave={handleStagePointerLeave}
                onMouseMove={handleStandardImageMove}
                onError={() => {
                  setError('Unable to load the selected image')
                  resetObjectUrl()
                  setRenderTarget(null)
                }}
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget
                  if (analysisCanvasRef.current) {
                    analysisCanvasRef.current.width = naturalWidth
                    analysisCanvasRef.current.height = naturalHeight
                    const ctx = analysisCanvasRef.current.getContext('2d', { willReadFrequently: true })
                    try {
                      ctx?.drawImage(event.currentTarget, 0, 0, naturalWidth, naturalHeight)
                    } catch (drawError) {
                      setPickerError('Unable to prepare image data for sampling')
                    }
                  }
                  setRenderTarget((prev) => {
                    if (!prev || prev.kind !== 'standard') return prev
                    if (prev.width === naturalWidth && prev.height === naturalHeight) return prev
                    return {
                      ...prev,
                      width: naturalWidth,
                      height: naturalHeight,
                    }
                  })
                }}
              />
            )}
            {pickedColor && tooltip && !netpbmTextError && (
              <div
                className="picker-tooltip"
                style={{
                  left: `${tooltip.left}px`,
                  top: `${tooltip.top}px`,
                }}
              >
                <span className="picker-tooltip__swatch" style={{ backgroundColor: `rgb(${pickedColor.r}, ${pickedColor.g}, ${pickedColor.b})` }} />
                <div className="picker-tooltip__details">
                  <span>{pickedHex}</span>
                  <span>
                    RGB {pickedColor.r}, {pickedColor.g}, {pickedColor.b}
                  </span>
                  <span>
                    {pickedColor.x}, {pickedColor.y}
                  </span>
                </div>
              </div>
            )}
          </div>
          {renderTarget.kind === 'netpbm' && (
            <div className={`netpbm-text${netpbmTextError ? ' netpbm-text--invalid' : ''}`}>
              <div className="netpbm-text__header">
                <span>Text representation</span>
                <span className="netpbm-text__meta">
                  Showing {renderTarget.format} as {renderTarget.format === 'P3' || renderTarget.format === 'P6' ? 'P3' : 'P2'}
                </span>
              </div>
              <textarea
                className="netpbm-text__editor"
                value={netpbmText}
                onChange={onNetpbmTextChange}
                spellCheck={false}
                placeholder="Paste a P2/P3 Netpbm text representation here..."
              />
              {netpbmTextError ? (
                <span className="netpbm-text__error">{netpbmTextError}</span>
              ) : (
                <span className="netpbm-text__hint">Edit pixel values and metadata to update the preview instantly.</span>
              )}
            </div>
          )}
          {pickerError && <span className="picker-error">{pickerError}</span>}
          <canvas ref={analysisCanvasRef} className="analysis-canvas" aria-hidden="true" />
        </section>
      )}
    </div>
  )
}

export default App
