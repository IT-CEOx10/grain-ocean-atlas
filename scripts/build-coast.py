"""Build a coast-distance data texture from the shipped Natural Earth polygons.
Requires Pillow, NumPy and SciPy. No external requests; not a painted background.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

root = Path(__file__).resolve().parents[1]
width, height = 2048, 1536
bounds = (-33.0, -2.0, 85.0, 72.0)
west, south, east, north = bounds
mask = Image.new('L', (width, height))
draw = ImageDraw.Draw(mask)
def project(ring):
    return [((lng-west)/(east-west)*width, (north-lat)/(north-south)*height) for lng, lat in ring]
for feature in json.loads((root/'dist/countries.json').read_text())['features']:
    geometry = feature['geometry']
    polygons = [geometry['coordinates']] if geometry['type']=='Polygon' else geometry['coordinates']
    for polygon in polygons:
        draw.polygon(project(polygon[0]), fill=255)
        for hole in polygon[1:]:
            draw.polygon(project(hole), fill=0)
land = np.array(mask) > 127
distance = distance_transform_edt(~land, sampling=((north-south)/height, (east-west)*.86/width))
# Square-root encoding retains precision at narrow coastlines. Maximum distance: 3 map units.
encoded = np.uint8(np.clip(np.sqrt(distance/3.0), 0, 1)*255)
texture = np.stack([encoded, np.uint8(land)*255, np.zeros_like(encoded)], axis=-1)
Image.fromarray(texture).save(root/'dist/coast-distance.png', optimize=True)
print(f'Coastal distance texture: {width}×{height}')
