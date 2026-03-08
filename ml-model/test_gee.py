import ee

# Initialize Earth Engine
ee.Initialize()

# Load a satellite image
image = ee.Image('LANDSAT/LC08/C02/T1_TOA/LC08_044034_20140318')

# Print some info
print(image.getInfo())