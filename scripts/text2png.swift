// Usage: swift text2png.swift out.png "text" fontSize maxWidth
import AppKit
let a = CommandLine.arguments
guard a.count >= 5, let size = Double(a[3]), let maxW = Double(a[4]) else { exit(2) }
let para = NSMutableParagraphStyle(); para.alignment = .center
let attrs: [NSAttributedString.Key: Any] = [
  .font: NSFont.boldSystemFont(ofSize: size), .foregroundColor: NSColor.white, .paragraphStyle: para]
let str = NSAttributedString(string: a[2], attributes: attrs)
let pad = size * 0.4
let r = str.boundingRect(with: NSSize(width: maxW - 2*pad, height: 10000), options: [.usesLineFragmentOrigin])
let w = Int(ceil(r.width + 2*pad)), h = Int(ceil(r.height + 2*pad))
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8,
  samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor(calibratedWhite: 0, alpha: 0.55).setFill()
NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: w, height: h), xRadius: pad, yRadius: pad).fill()
str.draw(with: NSRect(x: pad, y: pad, width: r.width + 0, height: r.height), options: [.usesLineFragmentOrigin])
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[1]))
