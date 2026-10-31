#!/usr/bin/env python3
"""重新生成五张关键帧（阿里百炼 · wan2.5-t2i-preview）。

用法：
    export DASHSCOPE_API_KEY=sk-xxxx
    python3 tools/gen-keyframes.py

为什么参数是这几个（都是踩过坑换来的）：
  · prompt_extend=False   扩写会把"边框"和"配色"改写掉，五张风格立刻跑偏
  · watermark=False       不加这句，右下角会带平台署名
  · negative_prompt       不写负向词，红色会飘成玫红、荧光粉
  · 多层纸片 + 柔和投影   不写这句，出图是扁的矢量红，没有纸的厚度
"""
import json, os, sys, time, urllib.request, urllib.error

KEY = os.environ.get('DASHSCOPE_API_KEY')
if not KEY:
    sys.exit('先 export DASHSCOPE_API_KEY=...')

BASE = 'https://dashscope.aliyuncs.com/api/v1'
OUT_DIR = 'concept/generated'
SIZE = '1536*1024'          # 3:2，对得上页面的 --scene-ratio
MODEL = 'wan2.5-t2i-preview'

# 边框 + 配色 + 质感，每张都要带。少一句就翻车。
STYLE = (
    "整幅画面四周有一圈连续的、等宽的红色回纹边框，边框紧贴画面四边，四角完整闭合，"
    "边框宽度约占画面高度的百分之六。边框以内是米黄色宣纸底。"
    "全图只有两种颜色：朱红（偏暗的红，像朱砂）和米黄（像旧宣纸），禁止玫红、禁止荧光粉、禁止渐变。"
    "这件剪纸由多层纸片叠成：前后景物分别是不同的纸层，层与层之间有柔和的投影，纸片边缘微微翘起、有厚度。"
    "纸面有纤维质感，边缘有剪刀剪出的毛刺，白色细线是刻掉的纸，不是描边线条。"
    "平面纸雕，构图克制，大量留白。"
)

NEGATIVE = "玫红, 荧光粉, 品红, 3D浮雕, 塑料光泽, 高光, 文字, 水印, 描边线条, 真实照片, 渐变"

SCENES = {
    # 1 下船 · 1861 清
    'scene-1':  "一幅完整的中国传统剪纸作品。1861 年烟台开埠的港口码头：左边是烟台山，山上一座灯塔、"
                "几幢带拱窗的洋行楼房；海面上两艘大帆船；近处是红色木栈桥，桥上放着一只开着盖的木箱，"
                "箱里装满朱红的苹果。",
    # 2 葡萄 · 1892 清
    'scene-2':  "一幅完整的中国传统剪纸作品。山坡上的葡萄园：一排排葡萄架顺着坡势排列，"
                "藤蔓缠绕在架子上，垂下一串串葡萄；坡顶有一座老式的石砌小楼，屋顶是坡顶；"
                "远处是海和更远的山影。",
    # 3 窖 · 1894—1915 清
    'scene-3':  "一幅完整的中国传统剪纸作品。地下酒窖：一条长而深的拱形甬道，两侧是一道接一道的石砌拱券，"
                "拱券下面一个挨一个地排列着橡木酒桶，桶身有箍；甬道尽头透进一点光，地面是石砌的甬道。"
                "透视纵深，拱顶的弧线一层层退远，像隧道。",
    # 4 上厂 · 1915—1930 民国
    'scene-4':  "一幅完整的中国传统剪纸作品，静物构图。一张长桌上并排摆着五样东西："
                "左边是一只深色的葡萄酒瓶和一只高脚杯，中间一只带泡沫的啤酒杯，"
                "再往右一枚圆润的苹果和一只上窄下宽的梨，最右边是一只老式的圆形座钟。"
                "器物上要有镂空细节：酒杯上的高光细纹和酒面、啤酒杯上的泡沫和气泡、"
                "酒瓶上的镂空方标、座钟表盘上的罗马数字、梨表面的几道短弧线。没有品牌文字。",
    # 5 上山 · 1938—1949 民国
    'scene-5':  "一幅完整的中国传统剪纸作品。1938 年胶东山区：一个穿着旧棉袄的农民背对镜头，"
                "推着独轮车走在之字形的山路上，车上堆着装满苹果的柳条筐；远处几道起伏的山脊和松树，"
                "天上有几只排成人字的秋雁。只有背影，不出现面部。",
    # 6 建厂 · 1949—1978 新中国
    'scene-6':  "一幅完整的中国传统剪纸作品。上世纪五六十年代的工厂车间：车间里并排着几台老式机床，"
                "机床上有齿轮和摇把；屋顶横着天车轨道；墙上是高高的方格窗；"
                "车间外的空地上立着一根砖砌烟囱。画面里没有任何文字。",
    # 7 大港 · 改革开放
    'scene-7':  "一幅完整的中国传统剪纸作品。现代集装箱码头：码头边立着四台高大的岸桥，钢铁桁架的结构，"
                "吊臂伸向海面上一艘巨大的集装箱船；船身上一层层码着集装箱；"
                "码头上堆着一片集装箱堆场，箱子四四方方、一层叠一层；远处是海平线和更小的吊机剪影。",
    # 8 回乡 · 今天
    'scene-8':  "一幅完整的中国传统剪纸作品。今天栖霞的苹果园秋收：层层梯田上种着成排的苹果树，"
                "树冠圆润、挂着深红的果子；远处山脊上立着一台风力发电机；近景左侧一只柳条筐装满苹果。",
    # 9 出海 · 入世之后
    'scene-9':  "一幅完整的中国传统剪纸作品。海上发射：海面上一座方形发射平台，平台中央竖起一枚细长的火箭，"
                "尾部喷出金色火焰；下方是翻涌的海浪，浪尖是锯齿状的剪纸边缘；左下角放着一只木箱。",
    # 10 上天 · 2021
    'scene-10': "一幅完整的中国传统剪纸作品。中国空间站天和核心舱内部：一名航天员穿着舱内航天服，"
                "戴着头盔，面窗是亮的，看不到脸；他一只手举着一枚苹果送到嘴边，正要咬下去，"
                "苹果上已经缺了一口；身体在失重中微微上浮，一只手扶着舱壁的扶手。"
                "舱壁上有成排的设备机柜和线缆，一扇圆形舷窗外是地球的弧线。"
                "人物只用剪影和轮廓表现，不画五官，不画面部。",
    # 11 剪 · 非遗
    'scene-11': "一幅完整的中国传统剪纸作品。一张红纸剪出一枚苹果的镂空，镂空处露出底下的米黄宣纸，"
                "苹果旁留着一片叶子；右边放着一把同样朱红色的剪纸剪刀，四周散落几片红色纸屑。"
                "纸张是完全哑光的：表面粗糙、吸光，没有任何反光、没有高光、没有塑料光泽。"
                "朱红要偏暗、像朱砂，不要正红、不要玫红。",
}


def submit(prompt):
    payload = {
        'model': MODEL,
        'input': {'prompt': prompt, 'negative_prompt': NEGATIVE},
        'parameters': {'size': SIZE, 'n': 1, 'prompt_extend': False, 'watermark': False},
    }
    req = urllib.request.Request(
        BASE + '/services/aigc/text2image/image-synthesis',
        data=json.dumps(payload).encode(),
        headers={'Authorization': 'Bearer ' + KEY,
                 'Content-Type': 'application/json',
                 'X-DashScope-Async': 'enable'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())['output']['task_id']


def wait_for(task_id):
    """异步任务：每 4 秒问一次，最多等 6 分钟。"""
    for _ in range(90):
        time.sleep(4)
        req = urllib.request.Request(BASE + '/tasks/' + task_id,
                                     headers={'Authorization': 'Bearer ' + KEY})
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read())
        status = body['output'].get('task_status')
        if status == 'SUCCEEDED':
            return body['output']['results'][0]['url']
        if status in ('FAILED', 'CANCELED'):
            raise RuntimeError(json.dumps(body, ensure_ascii=False)[:300])
    raise TimeoutError(task_id)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, body in SCENES.items():
        dst = os.path.join(OUT_DIR, name + '.png')
        if os.path.exists(dst):
            print('skip', name)
            continue
        print('生成', name, flush=True)
        try:
            urllib.request.urlretrieve(wait_for(submit(body + STYLE)), dst)
            print('  ->', dst, os.path.getsize(dst) // 1024, 'KB', flush=True)
        except Exception as exc:
            print('  !! 失败', exc, flush=True)


if __name__ == '__main__':
    main()
