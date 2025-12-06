/**
 * The $1 Unistroke Recognizer (JavaScript Version)
 *
 * This class implements the geometric template matching algorithm.
 * It includes a set of default templates (Circle, Triangle, Check, etc.).
 *
 * Adapted for ES6 Modules and [x,y] array input.
 */

export default class OneDollar {
    constructor() {
        this.NumPoints = 64;
        this.SquareSize = 250.0;
        this.Origin = { x: 0, y: 0 };
        this.Diagonal = Math.sqrt(this.SquareSize * this.SquareSize + this.SquareSize * this.SquareSize);
        this.HalfDiagonal = 0.5 * this.Diagonal;
        this.AngleRange = 45.0; // Degree allowance for rotation
        this.AnglePrecision = 2.0;
        this.Phi = 0.5 * (-1.0 + Math.sqrt(5.0)); // Golden Ratio

        this.Templates = [];
        
        // Load default templates
        this.add('Triangle', [[137,139],[135,141],[133,144],[132,146],[130,149],[128,151],[126,155],[123,160],[120,166],[116,171],[112,177],[107,183],[102,188],[100,191],[95,195],[90,199],[86,203],[82,206],[80,209],[75,213],[73,213],[70,216],[67,219],[64,221],[61,223],[60,225],[62,226],[65,225],[67,226],[74,226],[77,227],[85,229],[91,230],[99,231],[108,232],[116,233],[125,233],[134,234],[145,233],[153,232],[160,233],[170,234],[177,235],[179,236],[186,237],[193,238],[198,239],[200,237],[202,239],[204,238],[206,234],[205,230],[202,222],[197,216],[192,207],[186,198],[179,189],[174,183],[167,177],[163,171],[159,163],[156,157],[152,150],[148,142],[145,137]]);
        this.add('X', [[254,457],[253,459],[251,468],[247,477],[242,482],[235,492],[225,502],[214,513],[202,525],[188,537],[172,549],[157,560],[142,572],[126,583],[111,593],[96,603],[83,612],[71,620],[60,626],[51,629],[46,631],[193,467],[191,469],[189,475],[187,484],[187,492],[189,503],[193,516],[199,528],[207,542],[217,556],[229,569],[242,583],[256,595],[269,606],[282,615],[292,621],[300,625]]);
        this.add('Rectangle', [[177,396],[177,399],[176,406],[174,414],[173,423],[170,432],[168,443],[166,454],[164,464],[162,475],[161,486],[159,496],[157,506],[155,516],[154,523],[154,527],[155,527],[163,526],[173,527],[184,527],[197,527],[210,528],[222,529],[235,529],[248,527],[259,526],[268,524],[275,523],[279,521],[279,519],[279,512],[279,502],[279,491],[279,480],[279,470],[279,459],[279,449],[280,440],[280,432],[280,422],[280,412],[280,404],[279,397],[279,392],[277,391],[273,391],[265,392],[256,392],[246,392],[235,392],[224,392],[213,392],[201,392],[189,392],[179,392],[172,392],[169,392]]);
        this.add('Circle', [[331,164],[332,164],[335,164],[339,165],[342,166],[349,168],[356,171],[363,175],[369,179],[376,183],[381,189],[387,196],[391,202],[395,210],[398,218],[399,226],[400,233],[400,242],[399,250],[397,258],[393,266],[388,274],[382,282],[375,289],[367,295],[358,300],[348,303],[339,305],[329,305],[319,304],[309,301],[300,297],[292,291],[284,284],[277,276],[272,267],[268,258],[266,249],[265,240],[266,231],[268,222],[272,213],[278,205],[285,197],[292,190],[301,184],[310,179],[319,175],[328,172],[335,170],[340,170]]);
        this.add('Check', [[225,409],[225,413],[225,418],[223,425],[221,432],[219,438],[217,445],[215,452],[214,458],[212,464],[212,467],[214,467],[218,465],[224,461],[231,455],[239,449],[249,441],[259,432],[270,422],[281,413],[292,404],[302,395],[311,387],[318,381],[324,375],[327,372]]);
        this.add('Caret', [[174,510],[174,508],[175,501],[178,492],[183,481],[190,469],[199,455],[208,443],[218,432],[227,422],[235,412],[244,403],[251,397],[257,392],[260,390],[262,390],[265,392],[269,397],[275,403],[281,412],[289,421],[297,432],[305,442],[312,453],[319,463],[325,473],[330,483],[334,492],[337,500],[339,505]]);
        this.add('ZigZag', [[182,364],[182,367],[182,374],[181,381],[179,388],[177,396],[176,403],[174,410],[173,417],[172,423],[172,425],[174,425],[179,422],[186,417],[196,411],[205,404],[215,397],[223,391],[230,387],[233,385],[235,385],[235,388],[233,395],[230,404],[226,412],[222,422],[218,431],[215,440],[212,448],[210,453],[210,456],[213,455],[220,451],[228,445],[239,438],[249,431],[260,424],[270,417],[279,411],[286,406],[290,403]]);
        this.add('Arrow', [[227,356],[226,362],[224,373],[221,385],[216,400],[212,414],[208,428],[204,441],[200,453],[195,463],[192,471],[190,475],[190,477],[192,476],[199,472],[208,465],[218,458],[228,451],[238,443],[247,436],[256,429],[263,423],[269,419],[271,418],[269,420],[263,426],[255,435],[246,445],[237,456],[228,467],[220,478],[212,488],[205,498],[198,507],[194,513],[193,515]]);
        this.add('Star', [[187,468],[187,469],[185,475],[183,483],[180,494],[178,506],[176,517],[173,528],[172,537],[171,544],[170,548],[172,548],[178,543],[188,535],[200,525],[213,515],[226,505],[239,495],[250,486],[259,479],[265,475],[268,473],[268,476],[265,483],[260,493],[254,506],[248,518],[242,530],[235,542],[230,553],[225,562],[223,567],[223,569],[226,566],[233,558],[243,548],[255,535],[268,523],[281,511],[293,500],[303,491],[311,483],[315,480]]);
    }

    /**
     * Primary method to recognize a gesture.
     * @param {Array} points - An array of points [[x,y], [x,y]...] or [{x,y}, {x,y}...]
     * @returns {Object} { name: string, score: number, ms: number }
     */
    check(points) {
        const t0 = performance.now();
        
        // 1. Convert to internal point format {x, y}
        let processedPoints = this._convertPoints(points);

        // 2. Pre-process the candidate points
        processedPoints = this._resample(processedPoints, this.NumPoints);
        const radians = this._indicativeAngle(processedPoints);
        processedPoints = this._rotateBy(processedPoints, -radians);
        processedPoints = this._scaleTo(processedPoints, this.SquareSize);
        processedPoints = this._translateTo(processedPoints, this.Origin);

        // 3. Compare against templates
        let b = +Infinity;
        let t = 0;

        for (let i = 0; i < this.Templates.length; i++) {
            const d = this._distanceAtBestAngle(
                processedPoints, 
                this.Templates[i], 
                -this.AngleRange, 
                +this.AngleRange, 
                this.AnglePrecision
            );
            if (d < b) {
                b = d;
                t = i;
            }
        }

        const t1 = performance.now();
        const score = 1.0 - (b / this.HalfDiagonal);

        return {
            name: this.Templates[t].Name,
            score: Math.max(score, 0.0), // Ensure score isn't negative
            ms: t1 - t0
        };
    }

    /**
     * Adds a new template to the recognizer.
     */
    add(name, points) {
        let processed = this._convertPoints(points);
        processed = this._resample(processed, this.NumPoints);
        const radians = this._indicativeAngle(processed);
        processed = this._rotateBy(processed, -radians);
        processed = this._scaleTo(processed, this.SquareSize);
        processed = this._translateTo(processed, this.Origin);
        
        // Add vector property for speed (Protractor optimization can be added later)
        this.Templates.push({
            Name: name, 
            Points: processed, 
            Vector: this._vectorize(processed) // Optional optimization
        });
    }

    // --- Helper Methods ---

    _convertPoints(rawPoints) {
        // Handle both [x,y] and {x,y}
        if (Array.isArray(rawPoints[0])) {
            return rawPoints.map(p => ({x: p[0], y: p[1]}));
        }
        return rawPoints;
    }

    _resample(points, n) {
        const I = this._pathLength(points) / (n - 1);
        let D = 0.0;
        const newPoints = [points[0]];
        for (let i = 1; i < points.length; i++) {
            const d = this._distance(points[i - 1], points[i]);
            if ((D + d) >= I) {
                const qx = points[i - 1].x + ((I - D) / d) * (points[i].x - points[i - 1].x);
                const qy = points[i - 1].y + ((I - D) / d) * (points[i].y - points[i - 1].y);
                const q = {x: qx, y: qy};
                newPoints.push(q);
                points.splice(i, 0, q);
                D = 0.0;
            } else {
                D += d;
            }
        }
        if (newPoints.length === n - 1) {
            newPoints.push({x: points[points.length - 1].x, y: points[points.length - 1].y});
        }
        return newPoints;
    }

    _indicativeAngle(points) {
        const c = this._centroid(points);
        return Math.atan2(c.y - points[0].y, c.x - points[0].x);
    }

    _rotateBy(points, radians) {
        const c = this._centroid(points);
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const newPoints = [];
        for (let i = 0; i < points.length; i++) {
            const qx = (points[i].x - c.x) * cos - (points[i].y - c.y) * sin + c.x;
            const qy = (points[i].x - c.x) * sin + (points[i].y - c.y) * cos + c.y;
            newPoints.push({x: qx, y: qy});
        }
        return newPoints;
    }

    _scaleTo(points, size) {
        const B = this._boundingBox(points);
        const newPoints = [];
        for (let i = 0; i < points.length; i++) {
            const qx = points[i].x * (size / B.width);
            const qy = points[i].y * (size / B.height);
            newPoints.push({x: qx, y: qy});
        }
        return newPoints;
    }

    _translateTo(points, pt) {
        const c = this._centroid(points);
        const newPoints = [];
        for (let i = 0; i < points.length; i++) {
            const qx = points[i].x + pt.x - c.x;
            const qy = points[i].y + pt.y - c.y;
            newPoints.push({x: qx, y: qy});
        }
        return newPoints;
    }

    _vectorize(points) {
        let sum = 0.0;
        const vector = [];
        for (let i = 0; i < points.length; i++) {
            vector.push(points[i].x);
            vector.push(points[i].y);
            sum += points[i].x * points[i].x + points[i].y * points[i].y;
        }
        const magnitude = Math.sqrt(sum);
        for (let i = 0; i < vector.length; i++) {
            vector[i] /= magnitude;
        }
        return vector;
    }

    _distanceAtBestAngle(points, T, a, b, threshold) {
        let x1 = this.Phi * a + (1.0 - this.Phi) * b;
        let f1 = this._distanceAtAngle(points, T, x1);
        let x2 = (1.0 - this.Phi) * a + this.Phi * b;
        let f2 = this._distanceAtAngle(points, T, x2);
        while (Math.abs(b - a) > threshold) {
            if (f1 < f2) {
                b = x2;
                x2 = x1;
                f2 = f1;
                x1 = this.Phi * a + (1.0 - this.Phi) * b;
                f1 = this._distanceAtAngle(points, T, x1);
            } else {
                a = x1;
                x1 = x2;
                f1 = f2;
                x2 = (1.0 - this.Phi) * a + this.Phi * b;
                f2 = this._distanceAtAngle(points, T, x2);
            }
        }
        return Math.min(f1, f2);
    }

    _distanceAtAngle(points, T, radians) {
        const newPoints = this._rotateBy(points, radians);
        return this._pathDistance(newPoints, T.Points);
    }

    _pathDistance(pts1, pts2) {
        let d = 0.0;
        for (let i = 0; i < pts1.length; i++) { // assumes pts1.length == pts2.length
            d += this._distance(pts1[i], pts2[i]);
        }
        return d / pts1.length;
    }

    _pathLength(points) {
        let d = 0.0;
        for (let i = 1; i < points.length; i++) {
            d += this._distance(points[i - 1], points[i]);
        }
        return d;
    }

    _distance(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    _centroid(points) {
        let x = 0.0, y = 0.0;
        for (let i = 0; i < points.length; i++) {
            x += points[i].x;
            y += points[i].y;
        }
        return {x: x / points.length, y: y / points.length};
    }

    _boundingBox(points) {
        let minX = +Infinity, maxX = -Infinity, minY = +Infinity, maxY = -Infinity;
        for (let i = 0; i < points.length; i++) {
            minX = Math.min(minX, points[i].x);
            maxX = Math.max(maxX, points[i].x);
            minY = Math.min(minY, points[i].y);
            maxY = Math.max(maxY, points[i].y);
        }
        return {x: minX, y: minY, width: maxX - minX, height: maxY - minY};
    }
}