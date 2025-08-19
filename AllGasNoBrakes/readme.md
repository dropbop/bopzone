# AllGasNoBrakes Photography

## How to Upload New Photos

1. Navigate to the `static/photos` directory in this repository
2. Click "Add file" > "Upload files"
3. Drag and drop your new photo files (JPG, PNG, or WebP format)
4. Add a commit message like "Add new car photos from Feb shoot"
5. Click "Commit changes"

Your photos will automatically be deployed to the website within a few minutes.

## Photo Guidelines

- Use high-quality images (recommended resolution: at least 1920x1080)
- Supported formats: JPG, JPEG, PNG, WebP
- Keep file sizes reasonable (ideally under 2MB per image)
- Images will be sorted alphabetically on the site, so name them accordingly (e.g., 001-ferrari.jpg, 002-porsche.jpg)


# Setting Up Your Custom Domain on Vercel

Once your site is deployed on Vercel, you can easily add a custom domain:

## Steps:

1. **Go to your Vercel dashboard** and select your project
2. **Click on "Domains" in the top navigation**
3. **Enter your domain name** (e.g., `allgasnobrakes.com`) and click "Add"
4. **Configure your DNS settings** according to Vercel's instructions:
   - Option 1: If your domain registrar is supported by Vercel, you can use the "Vercel for Domains" integration
   - Option 2: Add DNS records manually at your domain registrar:
     - Add an A record: `@` pointing to `76.76.21.21`
     - Add a CNAME record: `www` pointing to `cname.vercel-dns.com`

5. **Wait for DNS propagation** (can take up to 48 hours, but usually much faster)

## Benefits of Using Vercel's DNS:
- Automatic SSL certificates
- CDN edge caching for fast global performance
- DDoS protection
- Free subdomain on `vercel.app` as a backup

Your friend won't need to manage any DNS configuration after the initial setup.