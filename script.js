document.addEventListener('DOMContentLoaded', () => {
    // --- Global Variables & Constants ---
    let featureLayers = [];
    let isSearching = false;
    let countryBordersGeoJSON = null; // To store the large borders file

    const locationInput = document.getElementById('location-input');
    const iconContainer = document.getElementById('icon-container');
    const searchIconHTML = iconContainer.innerHTML;
    const spinnerHTML = '<div class="spinner"></div>';
    const toast = document.getElementById('toast');

    const layers = [
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' }),
        L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '&copy; Google' }),
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' })
    ];
    const layerNames = ["تاریک", "ماهواره‌ای", "ترکیبی", "ساده"];
    let currentLayerIndex = 0;

    // --- Map Initialization ---
    const map = L.map('location-map', { zoomControl: false, layers: [layers[0]] }).setView([30, 0], 2);
    
    // Add an SVG element to the map pane for flag patterns
    L.svg().addTo(map);
    const svgDefs = d3.select(map.getPanes().overlayPane).select("svg").append("defs");

    // --- Event Listeners ---
    iconContainer.addEventListener('click', () => handleSearch());
    locationInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') handleSearch();
    });
    document.getElementById('zoom-in').addEventListener('click', () => map.zoomIn());
    document.getElementById('zoom-out').addEventListener('click', () => map.zoomOut());
    document.getElementById('toggle-layer').addEventListener('click', cycleMapLayer);
    document.getElementById('fullscreen-toggle').addEventListener('click', () => document.body.classList.toggle('ui-hidden'));
    
    // --- Core Functions ---

    /**
     * Pre-fetches the GeoJSON file with all country borders for efficiency.
     */
    async function preloadCountryBorders() {
        try {
            const response = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
            if (!response.ok) throw new Error('Network response was not ok');
            countryBordersGeoJSON = await response.json();
            console.log("Country borders loaded successfully.");
        } catch (error) {
            console.error("Failed to load country borders:", error);
            showToast("خطا در بارگذاری مرزهای جهانی", true);
        }
    }

    /**
     * Handles the search logic when the user initiates a search.
     */
    async function handleSearch() {
        const query = locationInput.value.trim();
        if (!query || isSearching) return;
        
        toggleLoading(true);
        clearAllLayers();

        try {
            const countryData = await getCountryInfo(query);
            if (!countryData) {
                 throw new Error(`کشوری با نام "${query}" یافت نشد.`);
            }

            const countryGeoJsonFeature = findCountryGeometry(countryData.cca3);
            if (!countryGeoJsonFeature) {
                throw new Error(`مرزهای جغرافیایی برای ${countryData.name.common} یافت نشد.`);
            }

            displayCountryOnMap(countryData, countryGeoJsonFeature);

        } catch (error) {
            showToast(error.message, true);
        } finally {
            toggleLoading(false);
        }
    }

    /**
     * Fetches detailed information for a country from the REST Countries API.
     * @param {string} countryName - The name of the country to search for.
     * @returns {Promise<Object|null>} A promise that resolves to the country data object.
     */
    async function getCountryInfo(countryName) {
        const response = await fetch(`https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}?fields=name,capital,population,flags,cca3`);
        if (!response.ok) return null;
        const data = await response.json();
        return data[0]; // Return the first result which is usually the best match
    }

    /**
     * Finds the specific GeoJSON geometry for a country from the preloaded data.
     * @param {string} countryCodeISOA3 - The 3-letter ISO code of the country (e.g., "IRN").
     * @returns {Object|null} The GeoJSON feature object for the country.
     */
    function findCountryGeometry(countryCodeISOA3) {
        if (!countryBordersGeoJSON) return null;
        return countryBordersGeoJSON.features.find(
            feature => feature.properties.ISO_A3 === countryCodeISOA3
        );
    }
    
    /**
     * Displays the country's border and flag on the map.
     * @param {Object} countryData - Data from REST Countries API.
     * @param {Object} geoJsonFeature - The GeoJSON feature for the country's border.
     */
    function displayCountryOnMap(countryData, geoJsonFeature) {
        const flagUrl = countryData.flags.svg;
        const countryCode = countryData.cca3;

        // Create a unique SVG pattern for the country's flag
        const patternId = `flag-pattern-${countryCode}`;
        svgDefs.append("pattern")
            .attr("id", patternId)
            .attr("patternUnits", "objectBoundingBox")
            .attr("width", 1)
            .attr("height", 1)
            .append("image")
            .attr("xlink:href", flagUrl)
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", 1)
            .attr("height", 1)
            .attr("preserveAspectRatio", "xMidYMid slice");

        // Create the GeoJSON layer with the flag pattern as fill
        const layer = L.geoJSON(geoJsonFeature, {
            style: {
                className: 'neon-border', // For the animated border
                fillPattern: `url(#${patternId})` // Apply the flag pattern
            }
        }).addTo(map);

        // Create informative popup
        const population = countryData.population.toLocaleString('fa-IR');
        const popupContent = `
            <b>${countryData.name.common} (${countryData.name.official})</b><br>
            پایتخت: ${countryData.capital[0]}<br>
            جمعیت: ${population} نفر
        `;
        layer.bindPopup(popupContent).openPopup();
        
        featureLayers.push(layer);
        map.flyToBounds(layer.getBounds(), { padding: [50, 50] });
    }

    // --- Utility Functions ---

    function clearAllLayers() {
        featureLayers.forEach(layer => map.removeLayer(layer));
        featureLayers = [];
        svgDefs.selectAll("*").remove(); // Clear old flag patterns
    }

    function cycleMapLayer() {
        map.removeLayer(layers[currentLayerIndex]);
        currentLayerIndex = (currentLayerIndex + 1) % layers.length;
        map.addLayer(layers[currentLayerIndex]);
        showToast(`نقشه ${layerNames[currentLayerIndex]} فعال شد`);
    }

    function toggleLoading(loading) {
        isSearching = loading;
        iconContainer.innerHTML = loading ? spinnerHTML : searchIconHTML;
    }

    function showToast(message, isError = false) {
        toast.textContent = message;
        toast.className = isError ? 'show error' : 'show';
        setTimeout(() => {
            toast.className = toast.className.replace('show', '');
        }, 4000);
    }

    // --- Initial Load ---
    preloadCountryBorders().then(() => {
        handleSearch(); // Search for Iran on initial load
        locationInput.value = "Iran"; // Set initial value
    });
});
