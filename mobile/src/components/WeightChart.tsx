import { View } from 'react-native'
import Svg, { Polyline, Circle } from 'react-native-svg'

// Minimal weight trend sparkline. Uses react-native-svg (Expo-Go compatible, no
// Skia). `values` are in the user's display unit, oldest -> newest. victory-native
// can replace this later for axes/tooltips; this keeps the MVP dependency-light.
export function WeightChart({
  values,
  width,
  height = 140,
}: {
  values: number[]
  width: number
  height?: number
}) {
  if (values.length < 2) return null
  const pad = 14
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stepX = (width - pad * 2) / (values.length - 1)
  const xy = (v: number, i: number): [number, number] => [
    pad + i * stepX,
    pad + (1 - (v - min) / range) * (height - pad * 2),
  ]
  const points = values.map((v, i) => xy(v, i).join(',')).join(' ')
  const [lastX, lastY] = xy(values[values.length - 1], values.length - 1)

  return (
    <View>
      <Svg width={width} height={height}>
        <Polyline points={points} fill="none" stroke="#00b8d9" strokeWidth={2.5} />
        <Circle cx={lastX} cy={lastY} r={4.5} fill="#00b8d9" />
      </Svg>
    </View>
  )
}
