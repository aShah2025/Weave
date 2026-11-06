// Renders a caption to a transparent PNG (ffmpeg builds without libfreetype can't draw text).
// Usage: swift text2png.swift out.png "text" fontSize maxWidth [#rrggbb] [box 0|1] [bold|regular|serif|mono]
import AppKit
let a = CommandLine.arguments
guard a.count >= 5, let size = Double(a[3]), let maxW = Double(a[4]) else { exit(2) }
let hex = a.count > 5 ? a[5] : "#ffffff"
let box = a.count > 6 ? a[6] != "0" : true
let style = a.count > 7 ? a[7] : "bold"

func color(_ s: String) -> NSColor {
  var h = s.trimmingCharacters(in: .whitespaces); if h.hasPrefix("#") { h.removeFirst() }
  guard h.count == 6, let v = UInt32(h, radix: 16) else { return .white }
  return NSColor(calibratedRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
}
let font: NSFont = {
  switch style {
  case "regular": return NSFont.systemFont(ofSize: size, weight: .medium)
  case "serif": return NSFont(name: "Georgia-Bold", size: size) ?? NSFont.boldSystemFont(ofSize: size)
  case "mono": return NSFont.monospacedSystemFont(ofSize: size, weight: .bold)
  default: return NSFont.systemFont(ofSize: size, weight: .heavy)
  }
}()
let para = NSMutableParagraphStyle(); para.alignment = .center
var attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color(hex), .paragraphStyle: para]
if !box {
  let sh = NSShadow(); sh.shadowColor = NSColor(calibratedWhite: 0, alpha: 0.85); sh.shadowBlurRadius = size * 0.12; sh.shadowOffset = NSSize(width: 0, height: -size * 0.04)
  attrs[.shadow] = sh
  attrs[.strokeColor] = NSColor.black; attrs[.strokeWidth] = -2.5
}
let str = NSAttributedString(string: a[2], attributes: attrs)
let pad = size * 0.4
let r = str.boundingRect(with: NSSize(width: maxW - 2 * pad, height: 10000), options: [.usesLineFragmentOrigin])
let w = Int(ceil(r.width + 2 * pad)), h = Int(ceil(r.height + 2 * pad))
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8,
  samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
if box {
  NSColor(calibratedWhite: 0, alpha: 0.6).setFill()
  NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: w, height: h), xRadius: pad * 0.8, yRadius: pad * 0.8).fill()
}
str.draw(with: NSRect(x: pad, y: pad, width: r.width, height: r.height), options: [.usesLineFragmentOrigin])
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[1]))
