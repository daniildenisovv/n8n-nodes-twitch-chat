# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-10-12

### Changed

- **BREAKING CHANGE**: Messages are now streamed directly to XLSX files instead of being returned in memory
- Output format changed from array of messages to metadata object with file path and message count

### Added

- New required parameter `Output File Path` for specifying XLSX output location
- ExcelJS library for efficient streaming write to Excel files
- Automatic directory creation for output files
- Formatted Excel columns with proper headers and widths
- Support for JSON serialization of badges and emotes in Excel

### Improved

- Memory optimization: No message accumulation in RAM
- Suitable for high-volume, long-duration chat monitoring (thousands of messages)
- Low memory footprint regardless of stream duration
- Better performance with large message volumes

## [0.1.0] - Initial Release

### Added

- Initial release
- Support for reading chat messages from Twitch
- Configurable duration or monitor until stream ends
- Optional detailed user information (badges, emotes, colors)
- Debug mode for troubleshooting
- Twitch TMI API integration
