require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Servir archivos estáticos del frontend (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================
// CONFIGURACIÓN DE AWS SDK v3
// =========================================================
// El SDK de AWS automáticamente tomará las credenciales del 
// entorno o del Rol IAM asignado a la instancia EC2.
// Por seguridad NO se hardcodean access key ni secret key.
const s3Client = new S3Client({ region: 'us-east-1' });
const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// =========================================================
// CONFIGURACIÓN DE S3 Y MULTER
// =========================================================
const upload = multer({
    storage: multerS3({
        s3: s3Client,
        bucket: process.env.BUCKET_NAME || 'default-bucket-name', // Reemplazar con el variable de entorno
        acl: 'public-read', // Define que el objeto subido sea público
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            // Generar un nombre único para evitar colisiones en S3
            const extension = path.extname(file.originalname);
            cb(null, `posts/${Date.now().toString()}-${uuidv4()}${extension}`);
        }
    })
});

// =========================================================
// RUTAS DE LA API REST
// =========================================================

/**
 * GET /api/posts
 * Obtiene todos los posts de DynamoDB y los devuelve ordenados (del más reciente al más antiguo).
 */
app.get('/api/posts', async (req, res) => {
    try {
        const params = {
            TableName: 'PostsRedSocial'
        };
        
        // Operación de lectura (ScanCommand) con el SDK v3
        const command = new ScanCommand(params);
        const data = await docClient.send(command);
        
        // Ordenar en memoria por la Sort Key (CreatedAt) de forma descendente
        const posts = data.Items.sort((a, b) => b.CreatedAt - a.CreatedAt);
        
        res.status(200).json(posts);
    } catch (error) {
        console.error('Error al obtener posts:', error);
        res.status(500).json({ error: 'Error interno al obtener los posts' });
    }
});

/**
 * POST /api/posts
 * Crea un nuevo post. Recibe 'usuario', 'contenido' y opcionalmente un archivo de 'imagen'.
 * Intercepta la imagen, la sube a S3 y guarda todo el registro final en DynamoDB.
 */
app.post('/api/posts', upload.single('imagen'), async (req, res) => {
    try {
        const { usuario, contenido } = req.body;
        
        if (!usuario || !contenido) {
            return res.status(400).json({ error: 'El usuario y contenido son requeridos' });
        }

        // Si se subió imagen, multer-s3 expone la URL pública en req.file.location
        const imagenUrl = req.file ? req.file.location : null;
        
        const nuevoPost = {
            PostId: uuidv4(),      // Partition Key
            CreatedAt: Date.now(), // Sort Key
            Usuario: usuario,      // Atributo extra
            Contenido: contenido,  // Atributo extra
            ImagenUrl: imagenUrl   // Atributo extra
        };

        const params = {
            TableName: 'PostsRedSocial',
            Item: nuevoPost
        };

        // Operación de escritura (PutCommand) con el SDK v3
        const command = new PutCommand(params);
        await docClient.send(command);

        res.status(201).json({
            message: 'Post creado correctamente',
            post: nuevoPost
        });
    } catch (error) {
        console.error('Error al crear el post:', error);
        res.status(500).json({ error: 'Error al procesar y guardar la publicación' });
    }
});

// =========================================================
// INICIAR SERVIDOR
// =========================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor de Red Social ejecutándose y listo para recibir conexiones externas en AWS en el puerto ${PORT}`);
});
