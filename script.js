document.addEventListener('DOMContentLoaded', () => {
    let featureLayers = [];
    let isSearching = false;
    let multiLocationMode = false;
    let countryBorders = null; // برای نگهداری مرزهای دقیق کشورها

    const locationInput = document.getElementById('location-input');
    const iconContainer = document.getElementById('icon-container');
    const toast = document.getElementById('toast');
    const multiLocationToggle = document.getElementById('multi-location-toggle');
    const searchIconHTML = iconContainer.innerHTML;
    const spinnerHTML = '<div class="spinner"></div>';

    const map = L.map('location-map', { zoomControl: false }).setView([30, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    const svg = d3.select(map.getPanes().overlayPane).select("svg");
    const svgDefs = svg.append("defs");

    // --- Event Listeners ---
    iconContainer.addEventListener('click', handleSearch);
    locationInput.addEventListener('keyup', (event) => { if (event.key === 'Enter') handleSearch(); });
    multiLocationToggle.addEventListener('click', toggleMultiLocationMode);
    document.getElementById('zoom-in').addEventListener('click', () => map.zoomIn());
    document.getElementById('zoom-out').addEventListener('click', () => map.zoomOut());

    // --- Preload Data ---
    async function preloadData() {
        toggleLoading(true);
        showToast("در حال بارگذاری مرزهای دقیق...");
        try {
            // **مهم: فایل مرزها به صورت خودکار از اینترنت خوانده می‌شود**
            const bordersResponse = await fetch('https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json');
            if (!bordersResponse.ok) throw new Error(`Could not load border data: ${bordersResponse.statusText}`);
            countryBorders = await bordersResponse.json();
            showToast("نقشه آماده است", false);
        } catch (error) {
            console.error("Failed to preload data:", error);
            showToast("خطا در بارگذاری فایل مرزها", true);
        } finally {
            toggleLoading(false);
        }
    }

    // --- Core Functions ---
    function toggleMultiLocationMode() {
        multiLocationMode = !multiLocationMode;
        multiLocationToggle.classList.toggle('active', multiLocationMode);
        showToast(multiLocationMode ? "حالت چندمکانی فعال شد" : "حالت چندمکانی غیرفعال شد");
        if (!multiLocationMode) clearAllLayers();
    }

    function clearAllLayers() {
        featureLayers.forEach(layer => map.removeLayer(layer));
        featureLayers = [];
        svgDefs.selectAll("*").remove();
    }

    function toggleLoading(loading) {
        isSearching = loading;
        iconContainer.innerHTML = loading ? spinnerHTML : searchIconHTML;
    }

    function showToast(message, isError = false) {
        toast.textContent = message;
        toast.className = isError ? 'show error' : 'show';
        setTimeout(() => { toast.className = toast.className.replace('show', ''); }, 4000);
    }

    async function handleSearch() {
        const query = locationInput.value.trim();
        if (!query || isSearching || !countryBorders) {
            if (!countryBorders) showToast("داده‌های نقشه هنوز بارگذاری نشده", true);
            return;
        }

        toggleLoading(true);
        if (!multiLocationMode) clearAllLayers();

        const locationsToSearch = multiLocationMode ? query.split('+').map(name => name.trim().toLowerCase()).filter(Boolean) : [query.toLowerCase()];

        const promises = locationsToSearch.map(name => findAndDraw(name));
        await Promise.allSettled(promises);

        if (featureLayers.length > 0) {
            const group = new L.featureGroup(featureLayers);
            map.flyToBounds(group.getBounds(), { padding: [50, 50], maxZoom: 10, duration: 1.5 });
        }
        toggleLoading(false);
    }

    async function findAndDraw(query) {
        const countryFeature = countryBorders.features.find(f =>
            f.properties.name.toLowerCase() === query ||
            f.id.toLowerCase() === query
        );

        if (countryFeature) {
            await drawCountry(countryFeature);
        } else {
            await searchAndDrawGeneralLocation(query);
        }
    }

    async function drawCountry(countryFeature) {
        const countryCode = countryFeature.id; // کد سه حرفی کشور
        const countryName = countryFeature.properties.name;
        const countryDetails = await getCountryDetails(countryCode);

        if (!countryDetails) {
            showToast(`اطلاعات تکمیلی برای ${countryName} یافت نشد`, true);
            const style = { className: 'neon-border neon-border-simple' };
            const layer = L.geoJSON(countryFeature, { style });
            layer.bindPopup(`<b>${countryName}</b>`);
            featureLayers.push(layer);
            layer.addTo(map);
            return;
        }

        const flagUrl = countryDetails.flags.svg;
        const patternId = `flag-pattern-${countryCode}`;
        svgDefs.append("pattern")
            .attr("id", patternId)
            .attr("patternUnits", "objectBoundingBox")
            .attr("width", 1).attr("height", 1)
            .append("image")
            .attr("href", flagUrl)
            .attr("x", 0).attr("y", 0)
            .attr("width", 1).attr("height", 1)
            .attr("preserveAspectRatio", "xMidYMid slice");

        const style = { className: 'neon-border', fillPattern: `url(#${patternId})` };
        const layer = L.geoJSON(countryFeature, { style });

        const population = countryDetails.population.toLocaleString('fa-IR');
        const popupContent = `<b>${countryDetails.name.common}</b><br>پایتخت: ${countryDetails.capital[0]}<br>جمعیت: ${population} نفر`;
        layer.bindPopup(popupContent);
        featureLayers.push(layer);
        layer.addTo(map);
    }
    
    async function searchAndDrawGeneralLocation(query) {
        try {
            const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&polygon_geojson=1&limit=1`;
            const response = await fetch(nominatimUrl);
            const data = await response.json();
            if (!data || data.length === 0 || !data[0].geojson) throw new Error("Location not found");

            const location = data[0];
            const style = { className: 'neon-border neon-border-simple' };
            const layer = L.geoJSON(location.geojson, { style });
            layer.bindPopup(`<b>${location.display_name}</b>`);
            featureLayers.push(layer);
            layer.addTo(map);
        } catch (error) {
            showToast(`مکان "${query}" یافت نشد`, true);
        }
    }

    async function getCountryDetails(countryCode) {
        try {
            const url = `https://restcountries.com/v3.1/alpha/${countryCode}?fields=name,capital,population,flags`;
            const response = await fetch(url);
            if (!response.ok) return null;
            return await response.json();
        } catch (e) { return null; }
    }

    // --- Initial Load ---
    preloadData().then(() => {
        locationInput.value = "Iran";
        handleSearch();
    });
});
