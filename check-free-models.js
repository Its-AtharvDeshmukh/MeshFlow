// check-free-models.js
require('dotenv').config();

async function findFreeModels() {
    const url = `${process.env.MESH_API_URL || "https://api.meshapi.ai/v1"}/models`;
    
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${process.env.MESH_API_KEY}` }
        });

        const data = await response.json();
        
        console.log("\n🔍 SEARCHING FOR COMPLETELY FREE MODELS...\n");
        
        // BUG FIX: Check if the API returned an array directly, or wrapped it in 'data'
        const modelsArray = Array.isArray(data) ? data : (data.data || []);
        
        const freeModels = modelsArray.filter(m => 
            m.is_free === true || 
            (m.pricing && (m.pricing.prompt_usd_per_1k === "0" || m.pricing.prompt_usd_per_1k === "0.0000000000" || m.pricing.prompt_usd_per_1k === "None"))
        );

        if (freeModels.length > 0) {
            console.log("✅ FREE MODELS FOUND! Update your code to use one of these IDs:\n");
            freeModels.forEach(model => console.log(`👉 ${model.id}`));
        } else {
            console.log("❌ No free models found. You MUST top up your account balance to continue.");
        }

    } catch (err) {
        console.error("Error:", err.message);
    }
}

findFreeModels();