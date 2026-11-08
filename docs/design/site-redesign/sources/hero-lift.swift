// Apple Vision subject lift: writes the soft foreground mask (8-bit gray PNG,
// full source resolution) for all detected foreground instances.
import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let src = URL(fileURLWithPath: args[1]), dst = URL(fileURLWithPath: args[2])
let handler = VNImageRequestHandler(url: src)
let req = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([req])
guard let obs = req.results?.first else { print("no foreground"); exit(1) }
print("instances:", obs.allInstances.count)
let buf = try obs.generateScaledMaskForImage(forInstances: obs.allInstances, from: handler)
let ci = CIImage(cvPixelBuffer: buf)
let ctx = CIContext()
let gray = CGColorSpaceCreateDeviceGray()
guard let cg = ctx.createCGImage(ci, from: ci.extent, format: .L8, colorSpace: gray) else { exit(2) }
let out = CGImageDestinationCreateWithURL(dst as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(out, cg, nil)
CGImageDestinationFinalize(out)
print("mask", cg.width, cg.height)
