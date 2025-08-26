export function stringToEnum<T extends object>(
  enumObj: T,
  value: string | undefined | null,
  defaultValue: T[keyof T]
): T[keyof T] {
  if (value === null || value === undefined) return defaultValue
  const enumValues = Object.values(enumObj) as string[]
  if (enumValues.includes(value)) {
    return value as T[keyof T]
  }
  console.warn(
    `Invalid enum value '${value}' for enum ${Object.keys(enumObj)}. Returning default value '${defaultValue}'.`
  )
  return defaultValue
}
