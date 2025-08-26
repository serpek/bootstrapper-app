export class FileSystemError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message)
    this.name = 'FileSystemError'
  }
}

export class FileSizeExceededError extends FileSystemError {
  constructor(maxSize: number) {
    super(`File size exceeds the limit of ${maxSize}MB`, 'FILE_SIZE_EXCEEDED', {
      maxSize
    })
  }
}

export class UnsupportedFileTypeError extends FileSystemError {
  constructor(type: string) {
    super(`Unsupported file type: ${type}`, 'UNSUPPORTED_FILE_TYPE', { type })
  }
}

export class FileNotFoundError extends FileSystemError {
  constructor(id: string) {
    super(`File not found with ID: ${id}`, 'FILE_NOT_FOUND', { id })
  }
}

export function validateFile(file: File, maxSize: number): void {
  if (file.size > maxSize * 1024 * 1024) {
    throw new FileSizeExceededError(maxSize)
  }

  // Basit MIME type doğrulama
  const allowedTypes = [
    'image/',
    'video/',
    'audio/',
    'text/',
    'application/pdf',
    'application/json'
  ]

  if (
    !allowedTypes.some(
      (type) => file.type.startsWith(type) || file.type === type
    )
  ) {
    throw new UnsupportedFileTypeError(file.type)
  }
}
