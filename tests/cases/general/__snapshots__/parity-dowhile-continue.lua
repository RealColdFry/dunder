local ____exports = {}
function ____exports.__main()
    local arrTest = {0, 1, 2, 3, 4}
    local i = 0
    while true do
        do
            if i % 2 == 0 then
                i = i + 1
                goto ____continue_0
            end
            local j = 2
            while true do
                do
                    if j == 2 then
                        j = j - 1
                        goto ____continue_1
                    end
                    arrTest[i + 1] = j
                    j = j - 1
                end
                ::____continue_1::
                if not (j > 0) then
                    break
                end
            end
            i = i + 1
        end
        ::____continue_0::
        if not (i < #arrTest) then
            break
        end
    end
    return arrTest
end
return ____exports
