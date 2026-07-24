import { Context, Schema, h } from "koishi";
import * as Minio from 'minio'
import imghash from "imghash";

export const name = "yvlu-bot";

export interface Config {
  bucket: string
  endPoint: string
  endPort: string
  accessKey: string
  secretKey: string
  useSSL: boolean
}

export const Config: Schema<Config> = Schema.object({
  bucket: Schema.string()
    .description('MinIO Bucket 名称')
    .default('radio-bot'),
  endPoint: Schema.string()
    .description('MinIO EndPoint')
    .default('http://localhost'),
  endPort: Schema.string()
    .description('MinIO EndPort')
    .default('9000'),
  accessKey: Schema.string()
    .description('MinIO Access Key')
    .default('minioadmin'),
  secretKey: Schema.string()
    .description('MinIO Secret Key')
    .default('minioadmin'),
  useSSL: Schema.boolean()
    .description('是否使用 SSL')
    .default(false),
});

export const inject = ['database']

declare module 'koishi' {
  interface Tables {
    quote: quote
  }
}

export interface quote {
  id: number
  content_url: string
  author: string
  hash: string
  createdAt: Date
}
export async function apply(ctx: Context, config: Config) {

  const client = new Minio.Client({
    endPoint: config.endPoint,
    port: parseInt(config.endPort),
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
  })

  ctx.model.extend('quote', {
    id: 'unsigned',
    content_url: 'string',
    author: "string",
    createdAt: 'timestamp',
    hash: "string"
  }, {
    autoInc: true,
  })

  ctx.on('ready', async () => {
    const exists = await client.bucketExists(config.bucket)


    if (!exists) {
      await client.makeBucket(config.bucket)
    }
  })
  ctx.command('语录 <name:text> ', "群友语录").action(async ({ session }, name) => {
    if (name === "") {
      return "请输入name"
    }
    const result = await ctx.database.get('quote', { author: name }, ["content_url"])
    if (!session) return "error"
    if (result.length === 0) {
      return "没有找到相关语录"
    }
    await session.send(h('img', { src: result[Math.floor(Math.random() * result.length)].content_url }))
  })

  ctx.command('语录.上传 <name:text> <image:image>').action(async ({ session }, name, image) => {
    //* 在这里获取img,因为不知道为什么\n会截断解析,所以用手动获取的方法
    if (!session?.event?.message?.elements) return "error"
    const img = session.event.message.elements.find(
      e => e.type === "img"
    )
    const src = img?.attrs.src
    //* 在这里判断参数输入
    if (name === "") {
      return "请输入name"
    } else if (!src) {
      return '请发送一张图片'
    }
    //* 这里做一个获取dHash的操作
    const response = await fetch(src)
    const buffer = Buffer.from(await response.arrayBuffer())
    const hash = await imghash.hash(buffer);
    //* 这里从数据库中存取一次dHash,然后判断存不存在
    const result = await ctx.database.get('quote', { hash: hash }, ['id'])
    if (result.length) {
      return "图片已存在"
    }
    const fileName = `${Date.now()}-${hash}`
    await client.putObject(
      config.bucket,
      fileName,
      buffer,
      buffer.length,
      {
        'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream',
      },
    )
    const url = `https://${config.endPoint}:${config.endPort}/${config.bucket}/${fileName}`
    await ctx.database.create('quote', {
      content_url: url,
      author: name,
      createdAt: new Date(),
      hash: hash,
    })
    return "上传成功"
  })

}